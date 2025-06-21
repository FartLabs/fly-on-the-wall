# using pycord btw
import shutil
import discord
import os
import whisper 
import requests 
import asyncio
from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_API_GENERATE_ENDPOINT = OLLAMA_API_URL + "/api/generate"
print("OLLAMA_API_GENERATE_ENDPOINT:", OLLAMA_API_GENERATE_ENDPOINT)

assert DISCORD_TOKEN, "Please set the DISCORD_TOKEN environment variable."

intents = discord.Intents.default()
intents.message_content = True 
intents.voice_states = True

# command prefix not really needed since using slash commands 
bot = discord.Bot(intents=intents)

# stores active recordings, all keyed by guild ID
# this allows the bot to record in multiple servers simultaneously
active_recordings: dict[int, discord.VoiceClient] = {} 

async def transcribe_audio(file_path: str):
    """Transcribes a single audio file using the local Whisper model."""
    print(f"Loading Whisper model to transcribe {file_path}...")

    # for higher accuracy if needed, we can use 'medium' or 'large' 
    # tradeoff: slower, requires more compute resources 
    # see https://github.com/openai/whisper?tab=readme-ov-file#available-models-and-languages
    model = whisper.load_model("turbo")
    result = model.transcribe(file_path, fp16=False) 
    print("Transcription complete.")
    print(f"Transcription result: {result['text'][:100]}...")  # print first 100 chars for brevity
    return result['text']


async def summarize_text_with_ollama(text: str):
    """Sends text to a local LLM via Ollama for summarization."""
    print("Sending transcription to local LLM for summarization...")

    # TODO: Make the prompt and model configurable via .env
    prompt = f"""
    You are a highly efficient and helpful assistant specializing in summarizing meeting transcripts.
    Please analyze the following raw text from a meeting and provide a structured summary. 
    Ignore filler words (e.g., 'um', 'ah', 'like'), repeated sentences, and conversational pleasantries. 
    Focus only on the substantive content. If no action items or decisions were made, explicitly state
    "No specific action items or decisions were recorded."

   
    The summary should include:
    1. A concise, one-paragraph overview of the meeting's purpose and key discussions.
    2. A bulleted list of the main topics discussed. Go into detail about each topic based on what was said.
    3. A bulleted list of any action items or decisions made.

    Here is the transcript:
    ---
    {text}
    ---
    """

    payload = {
        "model": "llama3", 
        "prompt": prompt,
        # get the full response at once
        "stream": False 
    }

    try:
        # run the blocking requests call in a separate thread
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.post(OLLAMA_API_GENERATE_ENDPOINT, json=payload, timeout=300)
        )
        response.raise_for_status() 
        
        response_data = response.json()
        summary = response_data.get("response", "Error: Could not get a summary.")
        print("Summarization complete.")
        return summary
    except requests.exceptions.RequestException as e:
        print(f"Error communicating with Ollama: {e}")
        return f"Error: Could not connect to the local LLM. Is Ollama running?\nDetails: {e}"

async def finished_callback(sink: discord.sinks.WaveSink, channel: discord.TextChannel):
    """Handles the audio files once recording is complete."""
    await sink.vc.disconnect()

    processing_message = await channel.send("✅ Recording finished. Now processing audio for transcription...") 

    full_transcription = ""
    for user_id, audio_data in sink.audio_data.items():
        file_path = f"temp_recording_{user_id}.wav"
        with open(file_path, "wb") as f:
            f.write(audio_data.file.read())

        transcription = await transcribe_audio(file_path)
        user = await bot.fetch_user(user_id)
        full_transcription += f"[{user.display_name}]: {transcription}\n\n"
        
        os.remove(file_path)

    summary = await summarize_text_with_ollama(full_transcription)

    notes_filename = f"meeting_notes_{channel.guild.id}.txt"
    with open(notes_filename, "w", encoding="utf-8") as f:
        f.write(summary)
        
    # check if file is too large for Discord 
    # 10 mb is the limit for free users as of September 2024
    max_discord_file_size = 10 * 1024 * 1024  

    if os.path.getsize(notes_filename) > max_discord_file_size:
        notes_dir = "notes"
        os.makedirs(notes_dir, exist_ok=True)
        dest_path = os.path.join(notes_dir, notes_filename)
        shutil.move(notes_filename, dest_path)
        await channel.send(
            f"Meeting notes are too large to send via Discord. "
            f"The file has been saved to `{dest_path}` on the server."
        )
        return

    await channel.send(
        "Here are the meeting notes:",
        file=discord.File(notes_filename)
    )

    await processing_message.delete()
    os.remove(notes_filename)

@bot.event
async def on_ready():
    print(f'Logged in as {bot.user}')
    
@bot.slash_command(name="start_recording", description="Starts recording the voice channel.")
async def start_recording(ctx: discord.ApplicationContext):
    voice = ctx.author.voice
    if not voice or not voice.channel:
        await ctx.respond("You need to be in a voice channel to start recording.", ephemeral=True)
        return

    voice_channel = voice.channel

    if ctx.guild_id in active_recordings:
        await ctx.respond("I'm already recording in this server!", ephemeral=True)
        return

    try:
        vc = await voice_channel.connect()
        vc.start_recording(discord.sinks.WaveSink(), finished_callback, ctx.channel)
        active_recordings[ctx.guild_id] = vc
        await ctx.respond(f"🔴 Started recording in **{voice_channel.name}**! Use `/stop_recording` to finish.")
    except discord.ClientException as e:
        await ctx.respond(f"Error starting recording: {e}", ephemeral=True)
    

@bot.slash_command(name="stop_recording", description="Stops the recording and generates notes.")
async def stop_recording(ctx: discord.ApplicationContext):
    if ctx.guild_id not in active_recordings:
        await ctx.respond("I'm not currently recording anything here.", ephemeral=True)
        return
        
    # use defer() because the processing (transcription, etc.)
    # will happen in the background. 
    # this acknowledges the command immediately
    # await interaction.response.defer(ephemeral=False)

    vc = active_recordings.pop(ctx.guild_id)
    # triggers the finished_callback function after stopping the recording
    vc.stop_recording()
    await ctx.respond("Stopping the recording...")

@bot.slash_command(description="Sends the bot's latency.") 
async def ping(ctx: discord.ApplicationContext):
    await ctx.respond(f"Pong! Latency is {bot.latency}")

if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)

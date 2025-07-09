# using pycord btw
import shutil
import discord
import os
import whisper
import requests
import asyncio
import argparse
from dotenv import load_dotenv

load_dotenv()

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
OLLAMA_API_GENERATE_ENDPOINT = OLLAMA_API_URL + "/api/generate"
AVAILABLE_WHISPER_MODELS = whisper.available_models()

# check if file is too large for Discord
# 10 mb is the limit for free users as of September 2024
MAX_DISCORD_FILE_SIZE_MB = 10 * 1024 * 1024

assert DISCORD_TOKEN, "Please set the DISCORD_TOKEN environment variable."


intents = discord.Intents.default()
intents.message_content = True
intents.voice_states = True
intents.members = True

bot = discord.Bot(intents=intents)

# stores active recordings, all keyed by guild ID
# this allows the bot to record in multiple servers simultaneously
active_recordings: dict[int, discord.VoiceClient] = {}

parser = argparse.ArgumentParser(description="Discord Meeting Notes Bot")
parser.add_argument(
    "--whisper-model",
    type=str,
    default="base",
    help=f"Whisper model to use (available: {', '.join(AVAILABLE_WHISPER_MODELS)}). By default, it uses 'base'.",
)
args = parser.parse_args()

whisper_model: str = args.whisper_model
chosen_model = whisper_model.lower()
if chosen_model not in [m.lower() for m in AVAILABLE_WHISPER_MODELS]:
    raise ValueError(
        f"Invalid Whisper model '{whisper_model}'. "
        f"Available models: {', '.join(AVAILABLE_WHISPER_MODELS)}"
    )

WHISPER_MODEL_TYPE = chosen_model


async def transcribe_audio(file_path: str):
    """Transcribes a single audio file using the local Whisper model."""
    print(f"Loading Whisper model '{WHISPER_MODEL_TYPE}' to transcribe {file_path}...")

    # for higher accuracy if needed, we can use 'medium' or 'large'
    # tradeoff: slower, requires more compute resources
    # see https://github.com/openai/whisper?tab=readme-ov-file#available-models-and-languages
    model = whisper.load_model(WHISPER_MODEL_TYPE, download_root="./models/whisper/")
    result = model.transcribe(file_path, fp16=False)
    print("Transcription complete.")
    # print(
    #     f"Transcription result: {result['text'][:100]}..."
    # )  # print first 100 chars for brevity
    return result["text"]


async def summarize_text_with_ollama(text: str, participants: set[str]):
    """Sends text to a local LLM via Ollama for summarization."""

    prompt = f"""
    You are a highly efficient and helpful assistant specializing in summarizing meeting transcripts.
    Please analyze the following raw text from a meeting and provide a structured summary. 
    Ignore filler words (e.g., 'um', 'ah', 'like'), repeated sentences, and conversational pleasantries. 
    Focus only on the substantive content. If no action items or decisions were made, explicitly state
    "No specific action items or decisions were recorded." 
    
    **IF** the transcript is empty, contains only filler words (e.g., 'um', 'ah'), or consists solely of conversational pleasantries with no substance:
        - Your **ENTIRE** output should be a single, specific statement: "This meeting concluded with no substantive discussion."

    **ELSE** (if the transcript contains substantive discussion):
        - Proceed as usual with the summarization.
    
    In the summary, list the participants who were in the meeting as shown below:
    {", ".join(participants)}
   
    The summary should include:
    1. A concise, one-paragraph overview of the meeting's purpose and key discussions.
    2. A bulleted list of the main topics discussed. Go into detail about each topic based on what was said.
    3. A bulleted list of any action items or decisions made.
    
    If nothing was discussed at all, state that clearly in the overview.

    Here is the transcript:
    ---
    {text}
    ---
    """

    # TODO: make model configurable via command line argument
    payload = {
        "model": "llama3",
        "prompt": prompt,
        # get the full response at once
        "stream": False,
    }

    # run the blocking requests call in a separate thread
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None,
        lambda: requests.post(OLLAMA_API_GENERATE_ENDPOINT, json=payload, timeout=300),
    )
    response.raise_for_status()

    response_data = response.json()
    summary = response_data.get("response", "Error: Could not get a summary.")
    print("Summarization complete.")
    return summary


async def finished_callback(sink: discord.sinks.WaveSink, channel: discord.TextChannel):
    """Handles the audio files once recording is complete."""
    await sink.vc.disconnect()
    await channel.send(
        "✅ Recording finished. Now processing audio for transcription..."
    )
    try:
        full_transcription, participants = await get_transcription_and_participants(
            sink
        )
    except Exception as e:
        await channel.send(content=f"❌ Error processing audio: {e}.")
        print(f"Error processing audio: {e}")
        return

    # TODO: account for people that typed in the meeting
    # could have it auto create a thread or something to have people type their messages

    await channel.send(
        "Transcription complete. "
        "Now sending the transcription to the local LLM for summarization..."
    )
    try:
        content = await summarize_text_with_ollama(full_transcription, participants)
        await channel.send("LLM returned a summary of the meeting notes...")
    except Exception as e:
        await channel.send(
            content="⚠️ No summary could be generated. Will be using raw transcription instead..."
        )
        content = full_transcription
        print(f"Error summarizing text: {e}")

    await channel.send("Now sending the meeting notes...")
    try:
        await send_meeting_notes(channel, content)
    except Exception as e:
        await channel.send(content=f"❌ Error sending the content: {e}.")
        print(f"Error sending the content: {e}")


async def send_meeting_notes(channel: discord.TextChannel, summary: str) -> None:
    """Save and send meeting notes, handling Discord file size limits."""
    notes_filename = f"meeting_notes_{channel.guild.id}.txt"
    with open(notes_filename, "w", encoding="utf-8") as f:
        f.write(summary)

    if os.path.getsize(notes_filename) > MAX_DISCORD_FILE_SIZE_MB:
        notes_dir = "notes"
        os.makedirs(notes_dir, exist_ok=True)
        dest_path = os.path.join(notes_dir, notes_filename)
        shutil.move(notes_filename, dest_path)
        await channel.send(
            f"File is too large to send via Discord. "
            f"The file has been saved to `{dest_path}` on the server."
        )
        return

    await channel.send("Here is your file:", file=discord.File(notes_filename))
    os.remove(notes_filename)


async def get_transcription_and_participants(
    sink: discord.sinks,
) -> tuple[str, set[str]]:
    final_participant_ids = {member.id for member in sink.vc.channel.members}
    speaking_user_ids = set(sink.audio_data.keys())
    all_involved_user_ids = final_participant_ids.union(speaking_user_ids)
    full_transcription = ""

    # store names of participants for the summary of meeting notes
    participants = set()

    # transcribe each user's audio data if they spoke
    for user_id in all_involved_user_ids:
        user = bot.get_user(user_id)
        if user is None or user.bot:
            continue
        user_display_name = user.display_name or user.name
        user_transcript_name = f"{user_display_name}_{user_id}"
        participants.add(user_transcript_name)
        if user_id not in speaking_user_ids:
            full_transcription += (
                f"[{user_transcript_name}]: (was present but did not speak).\n\n"
            )
        else:
            file_path = f"temp_recording_{user_id}.wav"
            with open(file_path, "wb") as f:
                f.write(sink.audio_data[user_id].file.read())
            transcription = await transcribe_audio(file_path)
            full_transcription += f"[{user_transcript_name}]: {transcription}\n\n"
            os.remove(file_path)

    return full_transcription, participants


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    await cleanup_connections()


@bot.slash_command(
    name="start_recording", description="Starts recording the voice channel."
)
async def start_recording(ctx: discord.ApplicationContext):
    voice = ctx.author.voice
    if not voice or not voice.channel:
        await ctx.respond(
            "You need to be in a voice channel to start recording.", ephemeral=True
        )
        return

    voice_channel = voice.channel

    if voice_channel.guild.id in active_recordings:
        await ctx.respond("I'm already recording in this server!", ephemeral=True)
        return

    vc = None

    try:
        vc = await voice_channel.connect()
        vc.start_recording(discord.sinks.WaveSink(), finished_callback, ctx.channel)
        active_recordings[ctx.guild_id] = vc
        await ctx.respond(
            f"🔴 Started recording in **{voice_channel.name}**! Use `/stop_recording` to finish."
        )
    except asyncio.TimeoutError:
        print("Timed out while trying to connect to the voice channel.")
        # await ctx.respond("Timed out while trying to connect to the voice channel.", ephemeral=True)
        if vc and vc.is_connected():
            await vc.disconnect(force=True)
    except Exception as e:
        # await ctx.respond(f"Error starting recording: {e}", ephemeral=True)
        print(f"Error starting recording: {e}")
        if vc and vc.is_connected():
            print("Disconnecting due to error...")
            await vc.disconnect(force=True)
        if ctx.guild_id in active_recordings:
            del active_recordings[ctx.guild_id]
            print(f"Removed {ctx.guild_id} from active recordings due to error.")


@bot.slash_command(
    name="stop_recording", description="Stops the recording and generates notes."
)
async def stop_recording(ctx: discord.ApplicationContext):
    if ctx.guild_id not in active_recordings:
        await ctx.respond("I'm not currently recording anything here.", ephemeral=True)
        return

    vc = active_recordings.pop(ctx.guild_id)
    # triggers the finished_callback function after stopping the recording
    vc.stop_recording()
    await ctx.respond("Stopping the recording...")


@bot.slash_command(description="Sends the bot's latency.")
async def ping(ctx: discord.ApplicationContext):
    await ctx.respond(f"Pong! Latency is {bot.latency}")


async def cleanup_connections():
    """Clean up all active recordings and voice connections."""
    print("Cleaning up connections...")

    for guild_id, vc in list(active_recordings.items()):
        try:
            if vc.is_connected():
                vc.stop_recording()
                await vc.disconnect(force=True)
                print(f"Disconnected from guild {guild_id}")
        except Exception as e:
            print(f"Error disconnecting from guild {guild_id}: {e}")

    active_recordings.clear()

    for vc in bot.voice_clients:
        try:
            if vc.is_connected():
                await vc.disconnect(force=True)
                print(
                    f"Disconnected remaining voice client from {vc.channel.guild.name}"
                )
        except Exception as e:
            print(f"Error disconnecting voice client: {e}")

    print("Cleanup complete.")


if __name__ == "__main__":
    print(f"Using Whisper model: {WHISPER_MODEL_TYPE}")
    print(f"Using Ollama API at: {OLLAMA_API_URL}")
    print("Change the Whisper model with --whisper-model")

    bot.run(DISCORD_TOKEN)

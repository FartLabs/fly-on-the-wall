# Discord Meeting Notes (name is subject to change)

A bot that takes meeting notes for you and other people on a Discord voice channel. This tool records and summarizes meetings at FartLabs, allowing participants to focus on contributing to discussions without wasting mental effort to take effective meeting notes.

## Demo 

TBA

## Commands

1. `/start_recording`
2. `/stop_recording`

## Technology

This takes the local-first approach for using AI. 

1. PyCord for managing the discord bot itself
2. OpenAI's Whisper model for transcribing speech to text
3. llama3 via Ollama for summarizing the text

## Todo (as of 6-21-25)

* Add more controls: there is no way to stop or pause recordings
* Better error handling
* Be more flexible with choice of AI; don't be limited to Whisper or llama3
* Support multiple langauges during meetings and for writing notes

## Development 

### Discord Bot

1. Set up a Discord bot at <https://discord.com/developers/applications>.
2. Create a **New Application**. 
3. Go to the **Bot** tab and click **Add Bot**.
4. Enable **Privileged Gateway Intents**: You need the **Message Content** Intent.
5. Get the token: click **Reset Token** to reveal and take note of your bot's token, which will be used later.
6. Invite the Bot to Your Server: Go to the **OAuth2 -> URL Generator tab**. Select the scopes: **bot**, **applications.commands** Then, in the **Bot Permissions** section, select **Connect**, **Speak**, and **Send Messages**.
7. Copy the generated URL and paste it into your browser to invite the bot to your server.

### Environment

Set up the technologies below

1. Python 3.12+
2. ffmpeg
3. Ollama 

After setting them up, check if Ollama is running at `http://localhost:11434`.

Once it is running, install llama3 

```sh
ollama pull llama3
```

> In the future, this can be configured to use any LLM of your choice from Ollama.

Then, clone this repository and set up a virtual environment. This will isolate the packages from the rest of your system.

```sh
python -m venv venv # this will setup the virtual environment in the folder, `venv`.
```

In the `venv` folder, there will be a `Scripts/` directory. Look for the `activate` related files.
Depending on your OS, use them to activate your virtual environment:

```ps1
# windows powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\activate.ps1
```

After activation, install the packages:

```sh
pip install -r requirements
```

Then, create a `.env` based on `.env.example`

Finally, run the bot

```sh
python ./bot.py --whisper-model base
```


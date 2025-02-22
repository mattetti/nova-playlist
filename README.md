# nova-playlist

Program to retrieve and process the playlist/track rotation from Radio Nova https://www.nova.fr/

## What does it do

* Retrieves the information about the songs played over the last 30 days
* Caches the daily schedule/playlist to disk.
* Creates a "global", unique playlist with a count of how many times each track was played
* Find the Youtube music information and inject that data in the global playlist

## Usage

By default, when launching the program, it will try to use the local cache (with potentially old data).
Pass the `-fetch` to get the data for the last 30 days.

## Youtube Playlist generator

To use it:

First, get your YouTube Data API key from Google Cloud Console
Build the binary:

```bash
go build -o ytplaylist bin/ytplaylist/main.go
```

Set your API key:

```bash
export YOUTUBE_API_KEY=your_api_key_here
```

Run it in different modes:

```bash
# Create playlist for specific month
./ytplaylist -month 10 -year 2024

# Create playlists for all available data
./ytplaylist -all

# Create public playlists
./ytplaylist -all -private=false

# Create playlist for current month, force overwrite if exists
./ytplaylist -skip-existing=false
```
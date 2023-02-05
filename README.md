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

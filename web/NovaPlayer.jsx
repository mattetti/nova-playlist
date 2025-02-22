import React, { useState, useEffect } from 'react';
import { Play, Pause, SkipForward, Shuffle, ListOrdered, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const NovaPlayer = () => {
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoId, setVideoId] = useState('');
  const [playMode, setPlayMode] = useState('sequential'); // 'sequential' or 'random'
  const [currentIndex, setCurrentIndex] = useState(0);
  const [tracks, setTracks] = useState([]);

  useEffect(() => {
    // Load all tracks from the playlist table
    const trackElements = document.querySelectorAll('.playlist-entry');
    const loadedTracks = Array.from(trackElements).map(track => ({
      title: track.querySelector('.title').textContent,
      artist: track.querySelector('.artist-name').textContent,
      ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href
    }));
    setTracks(loadedTracks);

    // Initialize YouTube Player
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      new window.YT.Player('youtube-player', {
        height: '0',
        width: '0',
        videoId: videoId,
        playerVars: {
          'playsinline': 1,
          'controls': 0
        },
        events: {
          'onStateChange': onPlayerStateChange
        }
      });
    };
  }, []);

  const getVideoId = (url) => {
    if (!url) return '';
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : '';
  };

  const playTrack = (track, index) => {
    setCurrentTrack(track);
    setVideoId(getVideoId(track.ytMusicUrl));
    setCurrentIndex(index);
    setIsPlaying(true);
  };

  const playNextTrack = () => {
    if (tracks.length === 0) return;

    if (playMode === 'random') {
      const randomIndex = Math.floor(Math.random() * tracks.length);
      playTrack(tracks[randomIndex], randomIndex);
    } else {
      // Sequential mode - go to next track or back to start
      const nextIndex = (currentIndex + 1) % tracks.length;
      playTrack(tracks[nextIndex], nextIndex);
    }
  };

  const onPlayerStateChange = (event) => {
    if (event.data === window.YT.PlayerState.ENDED) {
      playNextTrack();
    }
  };

  const togglePlayMode = () => {
    setPlayMode(prevMode => prevMode === 'sequential' ? 'random' : 'sequential');
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 className="h-6 w-6" />
            Nova Radio Player
          </div>
          <button
            onClick={togglePlayMode}
            className="p-2 rounded-full hover:bg-gray-100 flex items-center gap-1"
          >
            {playMode === 'sequential' ? (
              <><ListOrdered className="h-5 w-5" /> <span className="text-sm">Sequential</span></>
            ) : (
              <><Shuffle className="h-5 w-5" /> <span className="text-sm">Random</span></>
            )}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">
                {currentTrack ? currentTrack.title : 'No track selected'}
              </p>
              <p className="text-sm text-gray-500">
                {currentTrack ? currentTrack.artist : 'Click play to start'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => playNextTrack()}
                className="p-2 rounded-full hover:bg-gray-100"
                title={playMode === 'sequential' ? 'Next Track' : 'Random Track'}
              >
                <SkipForward className="h-6 w-6" />
              </button>
            </div>
          </div>

          <div id="youtube-player"></div>
        </div>
      </CardContent>
    </Card>
  );
};

export default NovaPlayer;
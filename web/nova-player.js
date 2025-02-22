// Wait for required libraries to load
function waitForLibraries() {
  return new Promise((resolve) => {
    function checkLibraries() {
      if (window.React && window.ReactDOM && window.lucide) {
        resolve();
      } else {
        console.log('Waiting for libraries...', {
          react: !!window.React,
          reactDOM: !!window.ReactDOM,
          lucide: !!window.lucide
        });
        setTimeout(checkLibraries, 100);
      }
    }
    checkLibraries();
  });
}

async function initializePlayer() {
  await waitForLibraries();
  console.log('All libraries loaded, initializing player...');

  const { useState, useEffect } = React;

  // Create icon elements using lucide
  const createIcon = (name, props = {}) => {
    const element = document.createElement('div');
    element.innerHTML = window.lucide.createElement({
      name: name.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2'),
      ...props
    });
    return element.children[0];
  };

  const NovaPlayer = () => {
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playMode, setPlayMode] = useState('sequential');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [tracks, setTracks] = useState([]);
    const [player, setPlayer] = useState(null);

    useEffect(() => {
      // Load tracks from playlist table
      const trackElements = document.querySelectorAll('.playlist-entry');
      const loadedTracks = Array.from(trackElements).map(track => ({
        title: track.querySelector('.title').textContent,
        artist: track.querySelector('.artist-name').textContent,
        ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href
      }));
      setTracks(loadedTracks);

      // Add click handlers to playlist entries
      trackElements.forEach((trackElement, index) => {
        trackElement.style.cursor = 'pointer';
        trackElement.addEventListener('click', (e) => {
          // Don't trigger if clicking on a link
          if (e.target.tagName === 'A') return;
          e.preventDefault();
          playTrack(loadedTracks[index], index);
        });
      });

      // Initialize YouTube IFrame API
      window.onYouTubeIframeAPIReady = () => {
        const newPlayer = new window.YT.Player('youtube-player', {
          height: '0',
          width: '0',
          videoId: '',
          playerVars: {
            playsinline: 1,
            controls: 0
          },
          events: {
            onStateChange: onPlayerStateChange,
            onError: (e) => console.error('YouTube player error:', e)
          }
        });
        setPlayer(newPlayer);
      };

      // Add styles for active track
      const style = document.createElement('style');
      style.textContent = `
        .playlist-entry.playing {
          background-color: #f3f4f6;
        }
        .playlist-entry:hover {
          background-color: #f9fafb;
        }
      `;
      document.head.appendChild(style);

      // Cleanup
      return () => {
        document.head.removeChild(style);
        trackElements.forEach(el => {
          el.style.cursor = '';
          el.removeEventListener('click');
        });
      };
    }, []);

    useEffect(() => {
      // Update playing state in UI
      document.querySelectorAll('.playlist-entry').forEach((el, index) => {
        if (index === currentIndex && isPlaying) {
          el.classList.add('playing');
        } else {
          el.classList.remove('playing');
        }
      });
    }, [currentIndex, isPlaying]);

    const getVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    };

    const playTrack = (track, index) => {
      if (!player || !track) return;

      const videoId = getVideoId(track.ytMusicUrl);
      if (!videoId) {
        console.error('Invalid video ID for track:', track);
        return;
      }

      setCurrentTrack(track);
      setCurrentIndex(index);
      setIsPlaying(true);

      if (player.loadVideoById) {
        player.loadVideoById(videoId);
      }
    };

    const togglePlayMode = () => {
      setPlayMode(prevMode => prevMode === 'sequential' ? 'random' : 'sequential');
    };

    const togglePlayPause = () => {
      if (!player) return;

      if (isPlaying) {
        player.pauseVideo();
        setIsPlaying(false);
      } else {
        if (!currentTrack && tracks.length > 0) {
          playTrack(tracks[0], 0);
        } else {
          player.playVideo();
          setIsPlaying(true);
        }
      }
    };

    const playNextTrack = () => {
      if (!tracks.length) return;

      let nextIndex;
      if (playMode === 'random') {
        nextIndex = Math.floor(Math.random() * tracks.length);
      } else {
        nextIndex = (currentIndex + 1) % tracks.length;
      }
      playTrack(tracks[nextIndex], nextIndex);
    };

    const onPlayerStateChange = (event) => {
      // Update playing state based on YouTube player state
      if (event.data === window.YT.PlayerState.ENDED) {
        playNextTrack();
      } else if (event.data === window.YT.PlayerState.PAUSED) {
        setIsPlaying(false);
      } else if (event.data === window.YT.PlayerState.PLAYING) {
        setIsPlaying(true);
      }
    };

    return React.createElement(
      'div',
      { className: 'w-full max-w-4xl mx-auto bg-white border-t shadow-lg p-4' },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between mb-4' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          createIcon('Volume2', { width: 24, height: 24 }),
          React.createElement('span', { className: 'font-bold' }, 'Nova Radio Player')
        ),
        React.createElement(
          'button',
          {
            onClick: togglePlayMode,
            className: 'p-2 rounded-full hover:bg-gray-100 flex items-center gap-2',
            title: playMode === 'sequential' ? 'Switch to random' : 'Switch to sequential'
          },
          [
            createIcon(playMode === 'sequential' ? 'ListOrdered' : 'Shuffle', { width: 20, height: 20 }),
            React.createElement('span', { key: 'text', className: 'text-sm' },
              playMode === 'sequential' ? 'Sequential' : 'Random'
            )
          ]
        )
      ),

      React.createElement(
        'div',
        { className: 'flex items-center justify-between' },
        React.createElement(
          'div',
          { className: 'space-y-1 flex-1 min-w-0' },
          React.createElement(
            'p',
            { className: 'text-sm font-medium leading-none truncate' },
            currentTrack ? currentTrack.title : 'Click any track to play'
          ),
          React.createElement(
            'p',
            { className: 'text-sm text-gray-500 truncate' },
            currentTrack ? currentTrack.artist : 'Or use the play button for sequential playback'
          )
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-4 ml-4' },
          React.createElement(
            'button',
            {
              onClick: togglePlayPause,
              className: 'p-2 rounded-full hover:bg-gray-100',
              title: isPlaying ? 'Pause' : 'Play'
            },
            createIcon(isPlaying ? 'Pause' : 'Play', { width: 24, height: 24 })
          ),
          React.createElement(
            'button',
            {
              onClick: playNextTrack,
              className: 'p-2 rounded-full hover:bg-gray-100',
              title: playMode === 'sequential' ? 'Next Track' : 'Random Track'
            },
            createIcon('SkipForward', { width: 24, height: 24 })
          )
        )
      ),
      React.createElement('div', { id: 'youtube-player', className: 'hidden' })
    );
  };

  // Initialize the player
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

// Start initialization when the page loads
window.addEventListener('load', initializePlayer);
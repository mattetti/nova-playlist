// Wait for required libraries to load
function waitForLibraries() {
  return new Promise((resolve) => {
    function checkLibraries() {
      if (window.React && window.ReactDOM && window.lucide) {
        resolve();
      } else {
        setTimeout(checkLibraries, 100);
      }
    }
    checkLibraries();
  });
}

async function initializePlayer() {
  console.log('Starting player initialization...');
  await waitForLibraries();
  console.log('Libraries loaded:', {
    react: !!window.React,
    reactDOM: !!window.ReactDOM,
    lucide: !!window.lucide,
    yt: !!window.YT
  });

  const { useState, useEffect, useRef } = React;

  // Create Lucide icon components
  const createIcon = (iconName, props = {}) => {
    // Convert iconName to kebab case as required by Lucide
    const kebabName = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    // Create the icon element using Lucide's global function
    const element = window.lucide.createIcons({
      icons: {
        [kebabName]: {
          width: props.size || 24,
          height: props.size || 24,
        }
      }
    });

    // Return a React element that wraps the icon
    return React.createElement('i', {
      className: `lucide lucide-${kebabName}`,
      style: { display: 'inline-block', width: props.size || 24, height: props.size || 24 }
    });
  };

  const NovaPlayer = () => {
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playMode, setPlayMode] = useState('sequential');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [tracks, setTracks] = useState([]);

    const playerRef = useRef(null);
    const youtubePlayerRef = useRef(null);

    useEffect(() => {
      // Load tracks from playlist table
      const trackElements = document.querySelectorAll('.playlist-entry');
      const loadedTracks = Array.from(trackElements).map(track => ({
        title: track.querySelector('.title').textContent,
        artist: track.querySelector('.artist-name').textContent,
        ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href,
        videoId: extractVideoId(track.querySelector('a[href*="music.youtube.com"]').href)
      }));
      setTracks(loadedTracks);

      // Initialize YouTube IFrame API
      if (window.YT) {
        initializeYouTubePlayer();
      } else {
        window.onYouTubeIframeAPIReady = initializeYouTubePlayer;
      }

      // Add click handlers to playlist entries
      const handleTrackClick = (index, e) => {
        if (e.target.tagName === 'A') return;
        e.preventDefault();
        playTrack(loadedTracks[index], index);
      };

      trackElements.forEach((el, index) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => handleTrackClick(index, e));
      });

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
        trackElements.forEach((el, index) => {
          el.style.cursor = '';
          el.removeEventListener('click', (e) => handleTrackClick(index, e));
        });
        document.head.removeChild(style);
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
        }
      };
    }, []);

    const initializeYouTubePlayer = () => {
      youtubePlayerRef.current = new window.YT.Player('youtube-player', {
        height: '200',
        width: '300',
        videoId: '',
        playerVars: {
          playsinline: 1,
          controls: 1,
          origin: window.location.origin,
          enablejsapi: 1
        },
        events: {
          onReady: (event) => {
            console.log('YouTube player ready');
            youtubePlayerRef.current = event.target; // Store the actual player instance
          },
          onStateChange: onPlayerStateChange,
          onError: (e) => console.error('YouTube player error:', e)
        }
      });
    };

    const extractVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      console.log('Extracting video ID from URL:', url, 'Result:', match ? match[1] : null);
      return match ? match[1] : '';
    };

    const playTrack = (track, index) => {
      if (!youtubePlayerRef.current || !track?.videoId) {
        console.log('Player or video ID not ready:', {
          player: !!youtubePlayerRef.current,
          videoId: track?.videoId
        });
        return;
      }

      // Verify that the player is ready and has the required methods
      if (typeof youtubePlayerRef.current.loadVideoById !== 'function') {
        console.log('Player methods not ready yet');
        return;
      }

      setCurrentTrack(track);
      setCurrentIndex(index);
      setIsPlaying(true);

      try {
        youtubePlayerRef.current.loadVideoById({
          videoId: track.videoId,
          startSeconds: 0
        });
        updatePlaylistHighlight(index);
      } catch (error) {
        console.error('Error playing track:', error);
      }
    };

    const updatePlaylistHighlight = (index) => {
      document.querySelectorAll('.playlist-entry').forEach((el, i) => {
        if (i === index) {
          el.classList.add('playing');
        } else {
          el.classList.remove('playing');
        }
      });
    };

    const togglePlayMode = () => {
      setPlayMode(prev => prev === 'sequential' ? 'random' : 'sequential');
    };

    const togglePlayPause = () => {
      if (!youtubePlayerRef.current) return;

      if (isPlaying) {
        youtubePlayerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        if (!currentTrack && tracks.length > 0) {
          playTrack(tracks[0], 0);
        } else {
          youtubePlayerRef.current.playVideo();
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
      if (event.data === window.YT.PlayerState.ENDED) {
        playNextTrack();
      } else if (event.data === window.YT.PlayerState.PAUSED) {
        setIsPlaying(false);
      } else if (event.data === window.YT.PlayerState.PLAYING) {
        setIsPlaying(true);
      }
    };

    // Create the component's elements using React.createElement
    return React.createElement(
      'div',
      {
        className: 'w-full max-w-4xl mx-auto bg-white shadow-lg p-4',
        ref: playerRef
      },
      React.createElement(
        'div',
        { className: 'flex items-center justify-between mb-4' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          createIcon('volume-2', { size: 24 }),
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
            createIcon(playMode === 'sequential' ? 'list-ordered' : 'shuffle', { size: 20 }),
            React.createElement(
              'span',
              { className: 'text-sm' },
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
            createIcon(isPlaying ? 'pause' : 'play', { size: 24 })
          ),
          React.createElement(
            'button',
            {
              onClick: playNextTrack,
              className: 'p-2 rounded-full hover:bg-gray-100',
              title: playMode === 'sequential' ? 'Next Track' : 'Random Track'
            },
            createIcon('skip-forward', { size: 24 })
          )
        )
      ),
      React.createElement('div', {
        id: 'youtube-player',
        className: 'w-full max-w-[300px] h-[200px] mt-4'
      })
    );
  };

  // Initialize the player
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

// Start initialization when the page loads
window.addEventListener('load', initializePlayer);
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
  await waitForLibraries();

  const { useState, useEffect, useRef, useCallback } = React;

  // Queue management helper
  function createQueue(tracks, mode = 'sequential') {
    const shuffled = mode === 'random'
      ? [...tracks].sort(() => Math.random() - 0.5)
      : [...tracks];
    return {
      tracks: shuffled,
      currentIndex: 0,
      mode
    };
  }

  // Create Lucide icon components
  function createIcon(name, props = {}) {
    return window.lucide.createElement(name, {
      size: props.size || 24,
      color: props.color || 'currentColor',
      strokeWidth: 2
    });
  }

  const NovaPlayer = () => {
    // Core state
    const [playerState, setPlayerState] = useState({
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      error: null
    });

    // Queue state with ref for async operations
    const [queue, setQueue] = useState(() => createQueue([]));
    const queueRef = useRef(null);
    useEffect(() => {
      queueRef.current = queue;
    }, [queue]);

    // Refs
    const playerRef = useRef(null);
    const youtubePlayerRef = useRef(null);
    const tracksRef = useRef([]);
    const playerStateRef = useRef(playerState);
    useEffect(() => {
      playerStateRef.current = playerState;
    }, [playerState]);

    // Initialize player and load tracks
    useEffect(() => {
      const loadTracks = () => {
        const trackElements = document.querySelectorAll('.playlist-entry');
        const tracks = Array.from(trackElements).map(track => ({
          id: track.dataset.title,
          title: track.querySelector('.title').textContent,
          artist: track.querySelector('.artist-name').textContent,
          ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href,
          videoId: extractVideoId(track.querySelector('a[href*="music.youtube.com"]').href)
        }));

        tracksRef.current = tracks;
        setQueue(createQueue(tracks, queue.mode));

        // Add click handlers
        trackElements.forEach((el, index) => {
          el.style.cursor = 'pointer';
          el.addEventListener('click', handleTrackClick);
        });

        // Add styles for active track
        const style = document.createElement('style');
        style.textContent = `
          .playlist-entry.playing {
            background-color: rgba(139, 92, 246, 0.1);
          }
          .playlist-entry:hover {
            background-color: rgba(139, 92, 246, 0.05);
          }
        `;
        document.head.appendChild(style);

        return () => {
          trackElements.forEach(el => {
            el.style.cursor = '';
            el.removeEventListener('click', handleTrackClick);
          });
          document.head.removeChild(style);
        };
      };

      return loadTracks();
    }, []);

    // YouTube player initialization
    useEffect(() => {
      const initYouTubePlayer = () => {
        youtubePlayerRef.current = new window.YT.Player('youtube-player', {
          height: '90',
          width: '160',
          videoId: '',
          playerVars: {
            playsinline: 1,
            controls: 0,
            origin: window.location.origin,
            enablejsapi: 1,
            autoplay: 0
          },
          events: {
            onReady: () => console.log('YouTube player ready'),
            onStateChange: handlePlayerStateChange,
            onError: handlePlayerError
          }
        });
      };

      if (window.YT) {
        initYouTubePlayer();
      } else {
        window.onYouTubeIframeAPIReady = initYouTubePlayer;
      }

      return () => {
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
        }
      };
    }, []);

    function handleTrackClick(e) {
      if (e.target.tagName === 'A') return;
      e.preventDefault();

      const trackElement = e.currentTarget;
      const index = Array.from(trackElement.parentElement.children).indexOf(trackElement);
      const currentTracks = tracksRef.current;

      setQueue(prev => {
        const newQueue = {
          ...prev,
          currentIndex: index,
          tracks: prev.mode === 'sequential' ? currentTracks : shuffleArray(currentTracks)
        };
        queueRef.current = newQueue; // Immediately update ref for async operations
        return newQueue;
      });

      // Use ref to ensure we have latest track data
      playTrack(currentTracks[index]);
    }

    function handlePlayerStateChange(event) {
      // Always work with latest state from refs for YouTube callbacks
      const currentPlayerState = playerStateRef.current;
      const currentQueue = queueRef.current;

      switch (event.data) {
        case window.YT.PlayerState.ENDED:
          if (currentQueue && currentPlayerState) {
            handleTrackEnd();
          }
          break;
        case window.YT.PlayerState.PLAYING:
          setPlayerState(prev => {
            const newState = { ...prev, isPlaying: true, isLoading: false };
            playerStateRef.current = newState; // Immediately update ref
            return newState;
          });
          break;
        case window.YT.PlayerState.PAUSED:
          setPlayerState(prev => {
            const newState = { ...prev, isPlaying: false };
            playerStateRef.current = newState;
            return newState;
          });
          break;
        case window.YT.PlayerState.BUFFERING:
          setPlayerState(prev => {
            const newState = { ...prev, isLoading: true };
            playerStateRef.current = newState;
            return newState;
          });
          break;
      }
    }

    function handlePlayerError(error) {
      console.error('YouTube player error:', error);
      setPlayerState(prev => ({
        ...prev,
        error: 'Failed to play track. Skipping to next...'
      }));

      // Auto-advance on error after a short delay
      setTimeout(() => {
        handleTrackEnd();
        setPlayerState(prev => ({ ...prev, error: null }));
      }, 3000);
    }

    function handleTrackEnd() {
      // Always use refs for latest state in async callbacks
      const currentQueue = queueRef.current;
      if (!currentQueue || !currentQueue.tracks.length) return;

      const nextIndex = (currentQueue.currentIndex + 1) % currentQueue.tracks.length;

      setQueue(prev => {
        const newQueue = { ...prev, currentIndex: nextIndex };
        queueRef.current = newQueue; // Immediately update ref
        return newQueue;
      });

      playTrack(currentQueue.tracks[nextIndex]);
    }

    function playTrack(track) {
      if (!youtubePlayerRef.current || !track?.videoId) return;

      setPlayerState(prev => ({
        ...prev,
        currentTrack: track,
        isLoading: true,
        error: null
      }));

      try {
        youtubePlayerRef.current.loadVideoById({
          videoId: track.videoId,
          startSeconds: 0
        });

        // Update playlist highlighting
        document.querySelectorAll('.playlist-entry').forEach((el) => {
          el.classList.toggle('playing', el.dataset.title === track.id);
        });
      } catch (error) {
        handlePlayerError(error);
      }
    }

    function togglePlayMode() {
      setQueue(prev => ({
        ...prev,
        mode: prev.mode === 'sequential' ? 'random' : 'sequential',
        tracks: prev.mode === 'sequential'
          ? shuffleArray(prev.tracks)
          : [...tracksRef.current]
      }));
    }

    function togglePlayPause() {
      if (!youtubePlayerRef.current) return;

      // Use refs for latest state values
      const currentPlayerState = playerStateRef.current;
      const currentQueue = queueRef.current;

      if (currentPlayerState.isPlaying) {
        youtubePlayerRef.current.pauseVideo();
      } else {
        if (!currentPlayerState.currentTrack && currentQueue?.tracks.length > 0) {
          playTrack(currentQueue.tracks[0]);
        } else {
          youtubePlayerRef.current.playVideo();
        }
      }
    }

    function extractVideoId(url) {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    }

    function shuffleArray(array) {
      return [...array].sort(() => Math.random() - 0.5);
    }

    // Render component
    return React.createElement(
      'div',
      {
        className: 'fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 shadow-lg',
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          zIndex: 50
        }
      },
      // Error message
      playerState.error && React.createElement(
        'div',
        {
          className: 'flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200'
        },
        createIcon('alert-circle', { size: 16 }),
        React.createElement(
          'span',
          { className: 'text-sm' },
          playerState.error
        )
      ),

      // Main container
      React.createElement(
        'div',
        { className: 'container mx-auto px-4 py-3' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between gap-4' },
          // Player info
          React.createElement(
            'div',
            { className: 'flex items-center gap-4 min-w-0 flex-1' },
            React.createElement(
              'div',
              { className: 'flex items-center gap-2' },
              createIcon('volume-2', { size: 18, color: '#A78BFA' }),
              React.createElement(
                'span',
                { className: 'font-medium text-sm bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent' },
                'Nova Radio'
              )
            ),
            React.createElement(
              'div',
              { className: 'space-y-1 min-w-0' },
              React.createElement(
                'p',
                { className: 'text-sm font-medium text-gray-100 truncate' },
                playerState.currentTrack?.title || 'Select a track to play'
              ),
              React.createElement(
                'p',
                { className: 'text-sm text-gray-400 truncate' },
                playerState.currentTrack?.artist || 'Use play button for sequential playback'
              )
            )
          ),
          // Controls
          React.createElement(
            'div',
            { className: 'flex items-center gap-4' },
            React.createElement(
              'button',
              {
                onClick: togglePlayMode,
                className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
                title: queue.mode === 'sequential' ? 'Switch to random' : 'Switch to sequential'
              },
              createIcon(queue.mode === 'sequential' ? 'list-ordered' : 'shuffle', { size: 18 })
            ),
            React.createElement(
              'button',
              {
                onClick: togglePlayPause,
                className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
                disabled: playerState.isLoading,
                title: playerState.isPlaying ? 'Pause' : 'Play'
              },
              createIcon(playerState.isPlaying ? 'pause' : 'play', { size: 24 })
            ),
            React.createElement(
              'button',
              {
                onClick: handleTrackEnd,
                className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
                title: 'Next track'
              },
              createIcon('skip-forward', { size: 18 })
            )
          )
        )
      ),
      // YouTube player (hidden but functional)
      React.createElement(
        'div',
        {
          id: 'youtube-player',
          className: 'h-0 overflow-hidden'
        }
      )
    );
  };

  // Initialize the player
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

// Start initialization when the page loads
window.addEventListener('load', initializePlayer);
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
    return React.createElement('i', {
      'data-lucide': kebabName,
      className: `lucide lucide-${kebabName}`,
      style: { display: 'inline-block', width: props.size || 24, height: props.size || 24 }
    });
  };

  const NovaPlayer = () => {
    // Core state with refs for async operations
    const [playerState, setPlayerState] = useState({
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      error: null
    });
    const playerStateRef = useRef(playerState);
    useEffect(() => {
      playerStateRef.current = playerState;
    }, [playerState]);

    // Queue state with refs and history
    const [queue, setQueue] = useState(() => ({
      tracks: [],
      currentIndex: 0,
      mode: 'sequential',
      history: [],  // Track play history
      futureQueue: [] // For tracks queued up manually
    }));
    const queueRef = useRef(queue);
    useEffect(() => {
      queueRef.current = queue;
    }, [queue]);

    const playerRef = useRef(null);
    const youtubePlayerRef = useRef(null);
    const tracksRef = useRef([]);

    useEffect(() => {
      // Load tracks from playlist table
      const trackElements = document.querySelectorAll('.playlist-entry');
      const loadedTracks = Array.from(trackElements).map(track => ({
        id: track.dataset.title,
        title: track.querySelector('.title').textContent,
        artist: track.querySelector('.artist-name').textContent,
        ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href,
        videoId: extractVideoId(track.querySelector('a[href*="music.youtube.com"]').href)
      }));

      console.log('Loaded tracks:', loadedTracks.length);
      tracksRef.current = loadedTracks;
      setQueue(prev => ({
        ...prev,
        tracks: loadedTracks
      }));

      // Preload first track in state (but don't play it)
      if (loadedTracks.length > 0) {
        setPlayerState(prev => ({
          ...prev,
          currentTrack: loadedTracks[0]
        }));
      }

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
        console.log('Manual track selection at index:', index);
        const currentTracks = tracksRef.current;

        setQueue(prev => {
          const newQueue = {
            ...prev,
            currentIndex: index,
            tracks: prev.mode === 'sequential' ? currentTracks : shuffleArray(currentTracks)
          };
          queueRef.current = newQueue;
          return newQueue;
        });

        playTrack(currentTracks[index]);
      };

      trackElements.forEach((el, index) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => handleTrackClick(index, e));
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
        height: '120',
        width: '200',
        videoId: '',
        playerVars: {
          playsinline: 1,
          controls: 1,
          origin: window.location.origin,
          enablejsapi: 1,
          autoplay: 1
        },
        events: {
          onReady: (event) => {
            console.log('YouTube player ready');
            youtubePlayerRef.current = event.target;
          },
          onStateChange: onPlayerStateChange,
          onError: (e) => console.error('YouTube player error:', e.data)
        }
      });
    };

    const extractVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    };

    const playTrack = (track) => {
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

      setPlayerState(prev => {
        const newState = {
          ...prev,
          currentTrack: track,
          isLoading: true,
          error: null
        };
        playerStateRef.current = newState;
        return newState;
      });

      try {
        youtubePlayerRef.current.loadVideoById({
          videoId: track.videoId,
          startSeconds: 0
        });
        updatePlaylistHighlight(track.id);
      } catch (error) {
        console.error('Error playing track:', error);
        handlePlayerError(error);
      }
    };

    const updatePlaylistHighlight = (trackId) => {
      document.querySelectorAll('.playlist-entry').forEach((el) => {
        el.classList.toggle('playing', el.dataset.title === trackId);
      });
    };

    const onPlayerStateChange = (event) => {
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
            playerStateRef.current = newState;
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
    };

    const handlePlayerError = (error) => {
      console.error('YouTube player error:', error);
      setPlayerState(prev => {
        const newState = {
          ...prev,
          error: 'Failed to play track. Skipping to next...'
        };
        playerStateRef.current = newState;
        return newState;
      });

      setTimeout(() => {
        handleTrackEnd();
        setPlayerState(prev => {
          const newState = { ...prev, error: null };
          playerStateRef.current = newState;
          return newState;
        });
      }, 3000);
    };

    const togglePlayMode = () => {
      setQueue(prev => {
        const newQueue = {
          ...prev,
          mode: prev.mode === 'sequential' ? 'random' : 'sequential',
          tracks: prev.mode === 'sequential'
            ? shuffleArray(prev.tracks)
            : [...tracksRef.current]
        };
        queueRef.current = newQueue;
        return newQueue;
      });
    };

    const handleTrackEnd = () => {
      const currentQueue = queueRef.current;
      if (!currentQueue || !currentQueue.tracks.length) return;

      // Save current track to history
      const currentTrack = currentQueue.tracks[currentQueue.currentIndex];

      setQueue(prev => {
        let nextIndex;
        let nextTracks = [...prev.tracks];

        // First check if we have any manually queued tracks
        if (prev.futureQueue.length > 0) {
          const nextTrack = prev.futureQueue[0];
          nextIndex = prev.tracks.findIndex(t => t.id === nextTrack.id);
          return {
            ...prev,
            currentIndex: nextIndex,
            history: [...prev.history, currentTrack],
            futureQueue: prev.futureQueue.slice(1)
          };
        }

        // Otherwise proceed based on play mode
        if (prev.mode === 'random') {
          // Avoid playing the same track twice in a row
          do {
            nextIndex = Math.floor(Math.random() * prev.tracks.length);
          } while (
            nextIndex === prev.currentIndex &&
            prev.tracks.length > 1
          );
        } else {
          nextIndex = (prev.currentIndex + 1) % prev.tracks.length;
        }

        const newQueue = {
          ...prev,
          currentIndex: nextIndex,
          history: [...prev.history, currentTrack]
        };
        queueRef.current = newQueue;
        return newQueue;
      });

      // Play the next track
      const nextTrack = currentQueue.tracks[
        currentQueue.futureQueue.length > 0
          ? currentQueue.tracks.findIndex(t => t.id === currentQueue.futureQueue[0].id)
          : (currentQueue.currentIndex + 1) % currentQueue.tracks.length
      ];
      playTrack(nextTrack);
    };

    const togglePlayPause = () => {
      if (!youtubePlayerRef.current) return;

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
    };

    const shuffleArray = (array) => {
      return [...array].sort(() => Math.random() - 0.5);
    };

    // Return the player component
    return React.createElement(
      'div',
      {
        className: 'fixed bottom-4 right-4 w-80 bg-gray-900 text-white shadow-lg rounded-lg border border-gray-800',
        ref: playerRef,
        style: {
          zIndex: 50,
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(17, 24, 39, 0.95)'
        }
      },
      // Error message if present
      playerState.error && React.createElement(
        'div',
        { className: 'flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200' },
        createIcon('alert-circle', { size: 16 }),
        React.createElement('span', { className: 'text-sm' }, playerState.error)
      ),
      React.createElement(
        'div',
        { className: 'p-3' },
        // Header with title and mode toggle
        React.createElement(
          'div',
          { className: 'flex items-center justify-between mb-2' },
          React.createElement(
            'div',
            { className: 'flex items-center gap-2' },
            createIcon('volume-2', { size: 18 }),
            React.createElement(
              'span',
              { className: 'font-medium text-sm bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent' },
              'Nova Radio'
            )
          ),
          React.createElement(
            'button',
            {
              onClick: togglePlayMode,
              className: 'p-2 rounded-full hover:bg-gray-700 flex items-center gap-2 text-gray-300 hover:text-white transition-colors',
              title: queue.mode === 'sequential' ? 'Switch to random' : 'Switch to sequential'
            },
            [
              createIcon(queue.mode === 'sequential' ? 'list-ordered' : 'shuffle', { size: 20 }),
              React.createElement(
                'span',
                { className: 'text-sm' },
                queue.mode === 'sequential' ? 'Sequential' : 'Random'
              )
            ]
          )
        ),
        // Track info and controls
        React.createElement(
          'div',
          { className: 'flex items-center justify-between' },
          React.createElement(
            'div',
            { className: 'space-y-1 flex-1 min-w-0' },
            React.createElement(
              'p',
              { className: 'text-sm font-medium leading-none truncate text-gray-100' },
              playerState.currentTrack ? playerState.currentTrack.title : 'Click any track to play'
            ),
            React.createElement(
              'p',
              { className: 'text-sm text-gray-400 truncate' },
              playerState.currentTrack ? playerState.currentTrack.artist : 'Or use the play button for sequential playback'
            )
          ),
          React.createElement(
            'div',
            { className: 'flex items-center gap-4 ml-4' },
            React.createElement(
              'button',
              {
                onClick: togglePlayPause,
                className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
                title: playerState.isPlaying ? 'Pause' : 'Play'
              },
              createIcon(playerState.isPlaying ? 'pause' : 'play', { size: 24 })
            ),
            React.createElement(
              'button',
              {
                onClick: handleTrackEnd,
                className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
                title: queue.mode === 'sequential' ? 'Next Track' : 'Random Track'
              },
              createIcon('skip-forward', { size: 18 })
            )
          )
        ),
        React.createElement(
          'div',
          {
            id: 'youtube-player',
            className: 'w-full h-[120px] mt-2 bg-gray-800 rounded-lg overflow-hidden'
          }
        )
      )
    );
  };

  // Initialize the player
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

// Start initialization when the page loads
window.addEventListener('load', initializePlayer);
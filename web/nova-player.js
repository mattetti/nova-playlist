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
    const kebabName = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const element = window.lucide.createIcons({
      icons: {
        [kebabName]: {
          width: props.size || 24,
          height: props.size || 24,
        }
      }
    });
    return React.createElement('i', {
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

    // Enhanced queue state with refs
    const [queue, setQueue] = useState(() => ({
      tracks: [],
      currentIndex: 0,
      mode: 'sequential',
      history: [],
      futureQueue: []
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
          onError: handlePlayerError
        }
      });
    };

    const extractVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    };

    const handleTrackClick = (index, e) => {
      if (e.target.tagName === 'A') return;
      e.preventDefault();

      const currentTracks = tracksRef.current;
      const selectedTrack = currentTracks[index];

      // If shift key is pressed, add to queue instead of playing immediately
      if (e.shiftKey) {
        setQueue(prev => {
          const newQueue = {
            ...prev,
            futureQueue: [...prev.futureQueue, selectedTrack]
          };
          queueRef.current = newQueue;
          return newQueue;
        });

        // Show feedback that track was queued
        const feedback = document.createElement('div');
        feedback.textContent = 'Track added to queue';
        feedback.className = 'fixed bottom-24 right-4 bg-purple-600 text-white px-4 py-2 rounded shadow-lg';
        document.body.appendChild(feedback);
        setTimeout(() => document.body.removeChild(feedback), 2000);
        return;
      }

      setQueue(prev => {
        const newQueue = {
          ...prev,
          currentIndex: index,
          tracks: prev.mode === 'sequential' ? currentTracks : shuffleArray(currentTracks),
          futureQueue: [] // Clear future queue when directly selecting a track
        };
        queueRef.current = newQueue;
        return newQueue;
      });

      playTrack(selectedTrack);
    };

    const playTrack = (track) => {
      if (!youtubePlayerRef.current || !track?.videoId) {
        console.log('Player or video ID not ready:', {
          player: !!youtubePlayerRef.current,
          videoId: track?.videoId
        });
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

    return React.createElement(
      'div',
      {
        className: 'fixed bottom-4 right-4 w-80 bg-gray-900/95 text-white shadow-lg rounded-lg border border-gray-800',
        ref: playerRef,
        style: {
          zIndex: 9999,
          backdropFilter: 'blur(10px)',
        }
      },
      // Error message if present
      playerState.error && React.createElement(
        'div',
        { className: 'flex items-center gap-2 px-4 py-2 bg-red-900/50 text-red-200 rounded-t-lg' },
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
              {
                className: 'font-medium text-sm',
                style: {
                  background: 'linear-gradient(to right, #A78BFA, #DB2777)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent'
                }
              },
              'Nova Radio'
            )
          ),
          React.createElement(
            'button',
            {
              onClick: togglePlayMode,
              className: 'p-2 rounded-full hover:bg-gray-700/50 flex items-center gap-2 text-gray-300 hover:text-white transition-colors',
              title: queue.mode === 'sequential' ? 'Switch to random' : 'Switch to sequential'
            },
            createIcon(queue.mode === 'sequential' ? 'list-ordered' : 'shuffle', { size: 20 }),
            React.createElement(
              'span',
              { className: 'text-sm' },
              queue.mode === 'sequential' ? 'Sequential' : 'Random'
            )
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
              { className: 'text-xs text-gray-400 truncate' },
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
                className: 'p-2 rounded-full hover:bg-gray-700/50 text-gray-300 hover:text-white transition-colors',
                title: playerState.isPlaying ? 'Pause' : 'Play'
              },
              createIcon(playerState.isPlaying ? 'pause' : 'play', { size: 24 })
            ),
            React.createElement(
              'button',
              {
                onClick: handleTrackEnd,
                className: 'p-2 rounded-full hover:bg-gray-700/50 text-gray-300 hover:text-white transition-colors',
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
            className: 'w-full h-[120px] mt-2 bg-gray-800/50 rounded-lg overflow-hidden'
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
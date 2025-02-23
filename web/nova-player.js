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

  // Helper to create Lucide icon elements
  const createIcon = (iconName, props = {}) => {
    const kebabName = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return React.createElement('i', {
      className: `lucide lucide-${kebabName}`,
      style: { display: 'inline-block', width: props.size || 24, height: props.size || 24 }
    });
  };

  const NovaPlayer = () => {
    // State for player status and current track
    const [playerState, setPlayerState] = useState({
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      error: null
    });
    const playerStateRef = useRef(playerState);
    useEffect(() => { playerStateRef.current = playerState; }, [playerState]);

    // Queue state
    const [queue, setQueue] = useState(() => ({
      tracks: [],
      currentIndex: 0,
      mode: 'sequential',
      history: [],
      futureQueue: []
    }));
    const queueRef = useRef(queue);
    useEffect(() => { queueRef.current = queue; }, [queue]);

    const youtubePlayerRef = useRef(null);
    const tracksRef = useRef([]);

    // Load tracks from the playlist table and attach click handlers
    useEffect(() => {
      const trackElements = document.querySelectorAll('.playlist-entry');
      const loadedTracks = Array.from(trackElements).map(track => {
        const ytMusicLink = track.querySelector('a[href*="music.youtube.com"]') ||
                           track.querySelector('.ytmusic[href*="music.youtube.com"]');
        if (!ytMusicLink?.href) {
          console.warn('Skipping track without YouTube Music link:', track.querySelector('.title')?.textContent);
          return null;
        }
        return {
          id: track.dataset.title || ytMusicLink.href,
          title: track.querySelector('.title')?.textContent || 'Unknown Title',
          artist: track.querySelector('.artist-name')?.textContent || 'Unknown Artist',
          ytMusicUrl: ytMusicLink.href,
          videoId: extractVideoId(ytMusicLink.href)
        };
      }).filter(track => track !== null);

      console.log('Loaded tracks:', loadedTracks.length);
      tracksRef.current = loadedTracks;
      setQueue(prev => ({ ...prev, tracks: loadedTracks }));

      // Preload first track (but do not autoplay)
      if (loadedTracks.length > 0) {
        setPlayerState(prev => ({ ...prev, currentTrack: loadedTracks[0] }));
      }

      // Initialize the YouTube IFrame API player
      if (window.YT) {
        initializeYouTubePlayer();
      } else {
        window.onYouTubeIframeAPIReady = initializeYouTubePlayer;
      }

      // Attach click handlers for each track
      trackElements.forEach((el, index) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => handleTrackClick(index, e));
      });

      // Add styles for active track highlighting
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

    // Initialize the YouTube player in the visible container
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

    // Utility: extract videoId from a YouTube URL
    const extractVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    };

    // Handle track click to either queue or play the track
    const handleTrackClick = (index, e) => {
      if (e.target.tagName === 'A') return;
      e.preventDefault();

      const currentTracks = tracksRef.current;
      const selectedTrack = currentTracks[index];

      if (e.shiftKey) {
        setQueue(prev => {
          const newQueue = { ...prev, futureQueue: [...prev.futureQueue, selectedTrack] };
          queueRef.current = newQueue;
          return newQueue;
        });
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
          futureQueue: []
        };
        queueRef.current = newQueue;
        return newQueue;
      });

      playTrack(selectedTrack);
    };

    // Load and play a given track
    const playTrack = (track) => {
      if (!youtubePlayerRef.current || !track?.videoId) {
        console.log('Player or video ID not ready:', {
          player: !!youtubePlayerRef.current,
          videoId: track?.videoId
        });
        return;
      }

      setPlayerState(prev => {
        const newState = { ...prev, currentTrack: track, isLoading: true, error: null };
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

    // Highlight the active track in the playlist
    const updatePlaylistHighlight = (trackId) => {
      document.querySelectorAll('.playlist-entry').forEach((el) => {
        el.classList.toggle('playing', el.dataset.title === trackId);
      });
    };

    const handlePlayerError = (error) => {
      console.error('YouTube player error:', error);
      setPlayerState(prev => {
        const newState = { ...prev, error: 'Failed to play track. Skipping to next...' };
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

    // Update state based on YouTube player's events
    const onPlayerStateChange = (event) => {
      switch (event.data) {
        case window.YT.PlayerState.ENDED:
          handleTrackEnd();
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

    // Handle track end to advance the queue
    const handleTrackEnd = () => {
      const currentQueue = queueRef.current;
      if (!currentQueue || !currentQueue.tracks.length) return;

      const currentTrack = currentQueue.tracks[currentQueue.currentIndex];
      setQueue(prev => {
        let nextIndex;
        if (prev.futureQueue.length > 0) {
          nextIndex = prev.tracks.findIndex(t => t.id === prev.futureQueue[0].id);
          return { ...prev, currentIndex: nextIndex, history: [...prev.history, currentTrack], futureQueue: prev.futureQueue.slice(1) };
        }
        nextIndex = prev.mode === 'random'
          ? Math.floor(Math.random() * prev.tracks.length)
          : (prev.currentIndex + 1) % prev.tracks.length;
        const newQueue = { ...prev, currentIndex: nextIndex, history: [...prev.history, currentTrack] };
        queueRef.current = newQueue;
        return newQueue;
      });

      const nextTrack = queueRef.current.tracks[
        queueRef.current.futureQueue.length > 0
          ? queueRef.current.tracks.findIndex(t => t.id === queueRef.current.futureQueue[0].id)
          : (queueRef.current.currentIndex + 1) % queueRef.current.tracks.length
      ];
      playTrack(nextTrack);
    };

    const togglePlayMode = () => {
      setQueue(prev => {
        const newQueue = {
          ...prev,
          mode: prev.mode === 'sequential' ? 'random' : 'sequential',
          tracks: prev.mode === 'sequential' ? shuffleArray(prev.tracks) : [...tracksRef.current]
        };
        queueRef.current = newQueue;
        return newQueue;
      });
    };

    const togglePlayPause = () => {
      if (!youtubePlayerRef.current) return;
      if (playerStateRef.current.isPlaying) {
        youtubePlayerRef.current.pauseVideo();
      } else {
        if (!playerStateRef.current.currentTrack && queueRef.current?.tracks.length > 0) {
          playTrack(queueRef.current.tracks[0]);
        } else {
          youtubePlayerRef.current.playVideo();
        }
      }
    };

    // Simple shuffle utility
    const shuffleArray = (array) => {
      return [...array].sort(() => Math.random() - 0.5);
    };

    return React.createElement(
      'div',
      {
        className: 'fixed bottom-4 right-4 w-80 bg-gray-900/95 text-white shadow-lg rounded-lg border border-gray-800',
        style: { zIndex: 9999, backdropFilter: 'blur(10px)' }
      },
      // Display any error message
      playerState.error &&
        React.createElement(
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
              'Radio Nova'
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
            React.createElement('span', { className: 'text-sm' }, queue.mode === 'sequential' ? 'Sequential' : 'Random')
          )
        ),
        // Track info and playback controls
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
        // Visible YouTube player container
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

  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

window.addEventListener('load', initializePlayer);
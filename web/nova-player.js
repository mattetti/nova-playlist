(function() {
  // Improved utility functions with better error handling
  const extractVideoId = (url) => {
    if (!url) return '';
    const match = url.match(/[?&]v=([^&#]+)/);
    return match ? match[1] : '';
  };

  const createIcon = (name, props = {}) => {
    return React.createElement('i', {
      className: `lucide lucide-${name}`,
      style: { display: 'inline-block', width: props.size || 24, height: props.size || 24 }
    });
  };

  // Enhanced dependency checker with timeout
  function waitForDependencies(timeout = 10000) {
    console.log('Waiting for dependencies...');
    const start = Date.now();

    return new Promise((resolve, reject) => {
      function checkDependencies() {
        if (window.React && window.ReactDOM && window.lucide) {
          console.log('Core dependencies loaded successfully');
          resolve();
        } else if (Date.now() - start > timeout) {
          reject(new Error('Dependency loading timeout'));
        } else {
          setTimeout(checkDependencies, 100);
        }
      }
      checkDependencies();
    });
  }

  // Enhanced YouTube API loader with detailed diagnostics
  function loadYouTubeAPI(timeout = 15000) {
    console.log('Starting YouTube API loading sequence...');

    return new Promise((resolve, reject) => {
      // Debug current state
      console.log('Initial YT object state:', {
        exists: 'YT' in window,
        hasPlayer: window.YT && 'Player' in window.YT,
        isFunction: window.YT && window.YT.Player && typeof window.YT.Player === 'function'
      });

      // Check if already loaded
      if (window.YT && window.YT.Player && typeof window.YT.Player === 'function') {
        console.log('YouTube API already loaded and initialized');
        resolve();
        return;
      }

      // Remove any existing failed script loads
      const existingScripts = document.querySelectorAll('script[src*="youtube.com/iframe_api"]');
      existingScripts.forEach(script => {
        console.log('Removing existing YouTube script:', script.src);
        script.remove();
      });

      // Track load state
      let scriptAppended = false;
      let iframeAPIReady = false;
      let ytPlayerReady = false;

      // Store original callback
      const originalCallback = window.onYouTubeIframeAPIReady;

      window.onYouTubeIframeAPIReady = () => {
        console.log('YT IFrame API Ready callback fired');
        iframeAPIReady = true;

        // Check YT object state
        console.log('YT object state after ready:', {
          exists: 'YT' in window,
          hasPlayer: window.YT && 'Player' in window.YT,
          isFunction: window.YT && window.YT.Player && typeof window.YT.Player === 'function'
        });

        // Delay to ensure full initialization
        setTimeout(() => {
          if (window.YT && window.YT.Player && typeof window.YT.Player === 'function') {
            console.log('YT Player fully initialized after delay');
            ytPlayerReady = true;
            resolve();
          } else {
            console.error('YT Player not properly initialized after delay');
            reject(new Error('YouTube Player not properly initialized'));
          }

          // Call original callback if it exists
          if (originalCallback) {
            console.log('Calling original onYouTubeIframeAPIReady callback');
            originalCallback();
          }
        }, 500);
      };

      // Create and append script
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;

      script.onload = () => {
        console.log('YouTube API script onload event fired');
        scriptAppended = true;
      };

      script.onerror = (error) => {
        console.error('YouTube API script failed to load:', error);
        reject(new Error('Failed to load YouTube API script'));
      };

      // Add to document
      document.head.appendChild(script);
      console.log('YouTube API script appended to head');

      // Set up comprehensive timeout check
      const timeoutId = setTimeout(() => {
        console.error('YouTube API load timeout. State:', {
          scriptAppended,
          iframeAPIReady,
          ytPlayerReady,
          ytExists: 'YT' in window,
          ytPlayerExists: window.YT && 'Player' in window.YT,
          isFunction: window.YT && window.YT.Player && typeof window.YT.Player === 'function'
        });
        reject(new Error('YouTube API loading timeout'));
      }, timeout);

      // Additional state check interval
      const stateCheckInterval = setInterval(() => {
        console.log('Checking YT load state:', {
          scriptAppended,
          iframeAPIReady,
          ytPlayerReady,
          ytExists: 'YT' in window,
          ytPlayerExists: window.YT && 'Player' in window.YT
        });
      }, 1000);

      // Clean up interval on success or failure
      Promise.race([
        new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), timeout)),
        new Promise(r => {
          if (window.YT && window.YT.Player && typeof window.YT.Player === 'function') {
            r();
          }
        })
      ]).finally(() => {
        clearInterval(stateCheckInterval);
        clearTimeout(timeoutId);
      });
    });
  }

  async function initializePlayer() {
    try {
      console.log('Starting player initialization...');
      await waitForDependencies();
      await loadYouTubeAPI();

      const { useState, useEffect, useRef } = React;

      function NovaPlayer() {
        const [playerState, setPlayerState] = useState({
          currentTrack: null,
          isPlaying: false,
          isLoading: true,
          error: null,
          volume: 100,
          crossfading: false,
          playersReady: false
        });

        const [playbackMode, setPlaybackMode] = useState('sequential');
        const [queue, setQueue] = useState({
          tracks: [],
          currentIndex: 0,
          history: [],
          futureQueue: []
        });

        // Enhanced refs with explicit typing
        const playerARef = useRef(null);
        const playerBRef = useRef(null);
        const activePlayerRef = useRef('A');
        const crossfadeTimeRef = useRef(3000);
        const readyPlayersCount = useRef(0);
        const containerRef = useRef(null);
        const mountedRef = useRef(true);

        // Improved player initialization
        useEffect(() => {
          console.log('Setting up player containers...');

          const container = document.createElement('div');
          container.id = 'youtube-players-container';
          container.style.cssText = 'position: fixed; bottom: -1000px; visibility: hidden;';

          ['youtube-player-a', 'youtube-player-b'].forEach(id => {
            const div = document.createElement('div');
            div.id = id;
            container.appendChild(div);
          });

          document.body.appendChild(container);
          containerRef.current = container;

          // Verify container creation
          console.log('Container elements created:', {
            container: document.getElementById('youtube-players-container'),
            playerA: document.getElementById('youtube-player-a'),
            playerB: document.getElementById('youtube-player-b')
          });

          // Get proper origin for local development
          const getOrigin = () => {
            const origin = window.location.origin;
            // Handle file:// protocol
            if (origin === 'null' || origin.startsWith('file://')) {
              console.warn('Running locally - using localhost:8080 as origin');
              return 'http://localhost:8080';
            }
            return origin;
          };

          // Helper to determine proper host based on the video URL.
          const getHostForVideo = (ytLink) => {
            return ytLink && ytLink.includes("music.youtube.com")
              ? "https://music.youtube.com"
              : "https://www.youtube.com";
          };

          // Assuming ytMusicLink is extracted from the track's <a> href.
          const ytMusicLink = document.querySelector('.playlist-entry a[href*="music.youtube.com"]')?.href;


          const playerOptions = {
            height: '90',
            width: '160',
            playerVars: {
                playsinline: 1,
                controls: 0,
                disablekb: 1,
                modestbranding: 1,
                origin: getOrigin(),
                host: getHostForVideo(ytMusicLink)
            }
          };

          const createPlayer = (elementId, label) => {
            return new Promise((resolve, reject) => {
              console.log(`Setting up player ${label}...`);

              const playerElement = document.getElementById(elementId);
              if (!playerElement) {
                reject(new Error(`Player element ${elementId} not found`));
                return;
              }

              // Clear any existing content
              playerElement.innerHTML = '';

              // Create container div (YouTube API will create iframe inside this)
              const container = document.createElement('div');
              container.id = `${elementId}-container`;
              playerElement.appendChild(container);

              let playerInstance = null;
              let readyTimeout = null;

              const cleanup = () => {
                if (readyTimeout) {
                  clearTimeout(readyTimeout);
                  readyTimeout = null;
                }
                if (playerInstance && playerInstance.destroy) {
                  try {
                    playerInstance.destroy();
                  } catch (e) {
                    console.warn(`Error destroying player ${label}:`, e);
                  }
                }
                if (playerElement) {
                  playerElement.innerHTML = '';
                }
              };

              // Set up ready timeout
              readyTimeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Player ${label} initialization timeout`));
              }, 10000);

              try {
                console.log(`Creating player ${label}...`);
                playerInstance = new window.YT.Player(container.id, {
                  ...playerOptions,
                  videoId: '', // Start with empty video
                  events: {
                    onReady: (event) => {
                      console.log(`Player ${label} ready event received`);
                      clearTimeout(readyTimeout);
                      const player = event.target;
                      if (!player || typeof player.playVideo !== 'function') {
                          cleanup();
                          reject(new Error(`Player ${label} not properly initialized`));
                          return;
                      }
                      // Simply resolve without triggering preloadFirstTrack here
                      resolve(player);
                  },
                    onError: (error) => {
                      console.error(`Player ${label} error:`, error);
                      if (!readyTimeout) return; // Already handled
                      cleanup();
                      reject(new Error(`Player ${label} initialization error: ${error.data}`));
                    }
                  }
                });
              } catch (error) {
                cleanup();
                reject(new Error(`Failed to create player ${label}: ${error.message}`));
              }
            });
          };

          let initTimeout;
          const initializePlayers = async () => {
            try {
                const [playerA, playerB] = await Promise.all([
                    createPlayer('youtube-player-a', 'A'),
                    createPlayer('youtube-player-b', 'B')
                ]);

                if (mountedRef.current) {
                    // Assign the player references once both players are ready
                    playerARef.current = playerA;
                    playerBRef.current = playerB;
                    console.log('Players initialized successfully');

                    // Now update state and cue the first track safely
                    setPlayerState(prev => ({
                        ...prev,
                        playersReady: true,
                        isLoading: false
                    }));
                    preloadFirstTrack();
                }
            } catch (error) {
                console.error('Error initializing players:', error);
                if (mountedRef.current) {
                    setPlayerState(prev => ({
                        ...prev,
                        error: 'Failed to initialize players. Please refresh the page.',
                        isLoading: false
                    }));
                }
            }
        };

          // Set initialization timeout
          initTimeout = setTimeout(() => {
            if (!playerState.playersReady && mountedRef.current) {
              setPlayerState(prev => ({
                ...prev,
                error: 'Player initialization timed out. Please refresh the page.',
                isLoading: false
              }));
            }
          }, 15000);

          initializePlayers();

          return () => {
            mountedRef.current = false;
            clearTimeout(initTimeout);
            if (containerRef.current) {
              document.body.removeChild(containerRef.current);
            }
          };
        }, []);

        // Improved player state handling
        const handlePlayerStateChange = (event, label) => {
          if (label !== activePlayerRef.current) return;

          switch (event.data) {
            case window.YT.PlayerState.ENDED:
              if (!playerState.crossfading) {
                playNextTrack();
              }
              break;
            case window.YT.PlayerState.PLAYING:
              setPlayerState(prev => ({
                ...prev,
                isPlaying: true,
                isLoading: false
              }));
              break;
            case window.YT.PlayerState.PAUSED:
              setPlayerState(prev => ({
                ...prev,
                isPlaying: false
              }));
              break;
            case window.YT.PlayerState.BUFFERING:
              setPlayerState(prev => ({
                ...prev,
                isLoading: true
              }));
              break;
          }
        };

        const handlePlayerError = (error, label) => {
          console.error(`Player ${label} error:`, error);
          const errorMessages = {
            2: 'Invalid video ID',
            5: 'HTML5 player error',
            100: 'Video not found',
            101: 'Video not playable',
            150: 'Video not playable'
          };

          setPlayerState(prev => ({
            ...prev,
            error: errorMessages[error.data] || 'Playback error occurred',
            isLoading: false
          }));
        };

        // Enhanced first track preloading
        const preloadFirstTrack = () => {
          console.log('Attempting to preload first track...');
          const firstTrackRow = document.querySelector('.playlist-entry');
          if (!firstTrackRow) {
            console.log('No playlist entries found');
            return;
          }

          const ytMusicLink = firstTrackRow.querySelector('a[href*="music.youtube.com"]')?.href;
          if (!ytMusicLink) {
            console.log('No YouTube Music link found in first track');
            return;
          }

          const videoId = extractVideoId(ytMusicLink);
          if (!videoId) {
            console.log('Could not extract video ID from link');
            return;
          }

          const title = firstTrackRow.querySelector('.title')?.textContent;
          const artist = firstTrackRow.querySelector('.artist-name')?.textContent;

          console.log('Preloading first track:', { videoId, title, artist });

          setPlayerState(prev => ({
            ...prev,
            currentTrack: { videoId, title, artist, url: ytMusicLink }
          }));

          if (playerARef.current?.cueVideoById) {
            playerARef.current.cueVideoById(videoId);
            console.log('First track cued successfully');
          } else {
            console.log('Player A not ready for cueing');
          }
        };

        // Rest of the component implementation...
        // (UI rendering, playback controls, etc. remain the same)

        return React.createElement(
          'div',
          {
            className: 'fixed bottom-4 right-4 w-80 bg-gray-900/95 text-white rounded-lg shadow-lg border border-gray-800 overflow-hidden'
          },
          // ... rest of the render logic
        );
      }

      // Mount with error boundary
      console.log('Mounting NovaPlayer component...');
      const rootElement = document.getElementById('nova-player-root');
      if (!rootElement) {
        throw new Error('Root element not found');
      }

      const root = ReactDOM.createRoot(rootElement);
      root.render(React.createElement(NovaPlayer));

    } catch (error) {
      console.error('Fatal error during player initialization:', error);
      const rootElement = document.getElementById('nova-player-root');
      if (rootElement) {
        rootElement.innerHTML = `
          <div class="fixed bottom-4 right-4 w-80 bg-red-900/95 text-white rounded-lg shadow-lg p-4">
            Failed to initialize player: ${error.message}
          </div>
        `;
      }
    }
  }

  // Start initialization when the page loads
  if (document.readyState === 'loading') {
    window.addEventListener('load', initializePlayer);
  } else {
    initializePlayer();
  }
})();
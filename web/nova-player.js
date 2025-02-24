// Wait for required libraries: React, ReactDOM, and YT API
function waitForLibraries() {
  return new Promise((resolve) => {
    function checkLibraries() {
      if (window.React && window.ReactDOM && window.YT) {
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
  const { useState, useEffect, useRef } = React;

  // Helper: Extract videoId from a YouTube Music URL
  function extractVideoId(url) {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : '';
  }

  function NovaPlayer() {
    const youtubePlayerARef = useRef(null);
    const youtubePlayerBRef = useRef(null);

    // Playlist queue loaded from the DOM (for preloading)
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    // Which deck is active: 'A' or 'B'
    const [activeDeck, setActiveDeck] = useState('A');
    const activeDeckRef = useRef(activeDeck);
    useEffect(() => {
      activeDeckRef.current = activeDeck;
    }, [activeDeck]);

    // Volume states for crossfade
    const [volumeA, setVolumeA] = useState(100);
    const [volumeB, setVolumeB] = useState(0);

    // The current track for each deck
    const [trackA, setTrackA] = useState(null);
    const [trackB, setTrackB] = useState(null);

    // Flag to prevent multiple crossfades at once
    const [isCrossfading, setIsCrossfading] = useState(false);

    // Flag for shuffle mode
    const [shuffle, setShuffle] = useState(false);

    // Flags for player readiness
    const [playerAReady, setPlayerAReady] = useState(false);
    const [playerBReady, setPlayerBReady] = useState(false);

    // 1) Load tracks from .playlist-entry and attach click listeners
    useEffect(() => {
      const entries = document.querySelectorAll('.playlist-entry');
      const loaded = Array.from(entries)
        .map(el => {
          const link = el.querySelector('a[href*="music.youtube.com"]');
          if (!link) return null;
          return {
            id: el.dataset.title || link.href,
            title: el.querySelector('.title')?.textContent || 'Unknown Title',
            artist: el.querySelector('.artist-name')?.textContent || 'Unknown Artist',
            videoId: extractVideoId(link.href)
          };
        })
        .filter(Boolean);

      setQueue(loaded);
      // Preload first two tracks into deck A and deck B
      if (loaded[0]) setTrackA(loaded[0]);
      if (loaded[1]) setTrackB(loaded[1]);

      entries.forEach(row => {
        row.addEventListener('click', handleRowClick);
      });
      return () => {
        entries.forEach(row => {
          row.removeEventListener('click', handleRowClick);
        });
      };
    }, []);

    // 2) Initialize YouTube players only once on mount
    useEffect(() => {
      function initDeckA() {
        youtubePlayerARef.current = new YT.Player('youtube-player-A', {
          height: '180',
          width: '320',
          videoId: '',
          playerVars: { controls: 1 },
          events: {
            onReady: (ev) => {
              setPlayerAReady(true);
              ev.target.setVolume(volumeA);
              if (trackA?.videoId && typeof ev.target.cueVideoById === 'function') {
                ev.target.cueVideoById(trackA.videoId);
              }
            },
            onStateChange: (ev) => {
              // If deck A (inactive) unexpectedly starts playing, switch active deck
              if (ev.data === YT.PlayerState.PLAYING &&
                  activeDeckRef.current !== 'A' &&
                  !isCrossfading) {
                if (youtubePlayerBRef.current) {
                  youtubePlayerBRef.current.stopVideo();
                }
                setActiveDeck('A');
                setVolumeA(100);
                if (youtubePlayerARef.current) {
                  youtubePlayerARef.current.setVolume(100);
                }
                setVolumeB(0);
              }
              // When deck A ends while active, trigger crossfade if trackB exists
              if (ev.data === YT.PlayerState.ENDED &&
                  activeDeckRef.current === 'A' &&
                  trackB &&
                  !isCrossfading) {
                startCrossfade();
              }
            },
            onError: (ev) => {
              console.error("Deck A error:", ev.data);
              // On error, unload deck A and transition immediately
              if (activeDeckRef.current === 'A' && !isCrossfading) {
                handleBadTrack('A');
              } else {
                setTrackA(null);
              }
            }
          }
        });
      }

      function initDeckB() {
        youtubePlayerBRef.current = new YT.Player('youtube-player-B', {
          height: '180',
          width: '320',
          videoId: '',
          playerVars: { controls: 1 },
          events: {
            onReady: (ev) => {
              setPlayerBReady(true);
              ev.target.setVolume(volumeB);
              if (trackB?.videoId && typeof ev.target.cueVideoById === 'function') {
                ev.target.cueVideoById(trackB.videoId);
              }
            },
            onStateChange: (ev) => {
              // If deck B (inactive) unexpectedly starts playing, switch active deck and ensure volume is set
              if (ev.data === YT.PlayerState.PLAYING &&
                  activeDeckRef.current !== 'B' &&
                  !isCrossfading) {
                if (youtubePlayerARef.current) {
                  youtubePlayerARef.current.stopVideo();
                }
                setActiveDeck('B');
                setVolumeB(100);
                if (youtubePlayerBRef.current) {
                  youtubePlayerBRef.current.setVolume(100);
                }
                setVolumeA(0);
              }
              // When deck B ends while active, trigger crossfade if trackA exists
              if (ev.data === YT.PlayerState.ENDED &&
                  activeDeckRef.current === 'B' &&
                  trackA &&
                  !isCrossfading) {
                startCrossfade();
              }
            },
            onError: (ev) => {
              console.error("Deck B error:", ev.data);
              if (activeDeckRef.current === 'B' && !isCrossfading) {
                handleBadTrack('B');
              } else {
                setTrackB(null);
              }
            }
          }
        });
      }

      if (window.YT && window.YT.Player) {
        initDeckA();
        initDeckB();
      } else {
        window.onYouTubeIframeAPIReady = () => {
          initDeckA();
          initDeckB();
        };
      }
    }, []);

    // Helper function to handle a bad track due to player error.
    function handleBadTrack(deck) {
      if (deck === 'A' && trackA) {
        const badVideoId = trackA.videoId;
        // Remove the bad track from the playlist.
        setQueue(prevQueue => prevQueue.filter(track => track.videoId !== badVideoId));
        if (youtubePlayerARef.current) {
          youtubePlayerARef.current.stopVideo();
        }
        // Immediately transition from deck A to deck B.
        finishErrorTransition('A', 'B');
      } else if (deck === 'B' && trackB) {
        const badVideoId = trackB.videoId;
        setQueue(prevQueue => prevQueue.filter(track => track.videoId !== badVideoId));
        if (youtubePlayerBRef.current) {
          youtubePlayerBRef.current.stopVideo();
        }
        finishErrorTransition('B', 'A');
      }
    }

    // This function immediately transitions from the errored deck (oldActive)
    // to the other deck (newActive) without any fade animation.
    function finishErrorTransition(oldActive, newActive) {
      if (oldActive === 'A') {
        setActiveDeck('B');
        setVolumeA(0);
        setVolumeB(100);
        setCurrentIndex(idx => {
          if (shuffle) {
            let newIndex = Math.floor(Math.random() * queue.length);
            if (queue.length > 1 && newIndex === idx) {
              newIndex = (newIndex + 1) % queue.length;
            }
            setTrackA(queue[newIndex]);
            return newIndex;
          } else {
            const newIndex = idx + 1;
            const nextTrack = queue[newIndex + 1];
            setTrackA(nextTrack ? nextTrack : null);
            return newIndex;
          }
        });
      } else {
        setActiveDeck('A');
        setVolumeB(0);
        setVolumeA(100);
        setCurrentIndex(idx => {
          if (shuffle) {
            let newIndex = Math.floor(Math.random() * queue.length);
            if (queue.length > 1 && newIndex === idx) {
              newIndex = (newIndex + 1) % queue.length;
            }
            setTrackB(queue[newIndex]);
            return newIndex;
          } else {
            const newIndex = idx + 1;
            const nextTrack = queue[newIndex + 1];
            setTrackB(nextTrack ? nextTrack : null);
            return newIndex;
          }
        });
      }
      setIsCrossfading(false);
    }

    // 3) Update deck A when trackA changes (only if player A is ready)
    useEffect(() => {
      if (playerAReady && youtubePlayerARef.current && trackA?.videoId) {
        if (activeDeckRef.current === 'A') {
          if (typeof youtubePlayerARef.current.loadVideoById === 'function') {
            youtubePlayerARef.current.loadVideoById(trackA.videoId);
          }
        } else {
          if (typeof youtubePlayerARef.current.cueVideoById === 'function') {
            youtubePlayerARef.current.cueVideoById(trackA.videoId);
          }
        }
      }
    }, [trackA, playerAReady]);

    // 4) Update deck B when trackB changes (only if player B is ready)
    useEffect(() => {
      if (playerBReady && youtubePlayerBRef.current && trackB?.videoId) {
        if (activeDeckRef.current === 'B') {
          if (typeof youtubePlayerBRef.current.loadVideoById === 'function') {
            youtubePlayerBRef.current.loadVideoById(trackB.videoId);
          }
        } else {
          if (typeof youtubePlayerBRef.current.cueVideoById === 'function') {
            youtubePlayerBRef.current.cueVideoById(trackB.videoId);
          }
        }
      }
    }, [trackB, playerBReady]);

    // 5) Check every second if active deck is within 3 seconds of track end
    useEffect(() => {
      const checkInterval = setInterval(() => {
        if (isCrossfading) return;
        const player = activeDeckRef.current === 'A' ? youtubePlayerARef.current : youtubePlayerBRef.current;
        if (player &&
            typeof player.getCurrentTime === 'function' &&
            typeof player.getDuration === 'function') {
          const currentTime = player.getCurrentTime();
          const duration = player.getDuration();
          if (duration > 0 && (duration - currentTime <= 3)) {
            startCrossfade();
          }
        }
      }, 1000);
      return () => clearInterval(checkInterval);
    }, [isCrossfading, trackA, trackB]);

    // 6) Handle row clicks by extracting track info from the row DOM.
    // Updated to check if the clicked element or one of its ancestors is an anchor.
    function handleRowClick(e) {
      if (e.target.closest && e.target.closest('a')) return;
      e.preventDefault();

      const row = e.currentTarget;
      const titleElem = row.querySelector('.title');
      const artistElem = row.querySelector('.artist-name');
      const link = row.querySelector('a[href*="music.youtube.com"]');

      const title = titleElem ? titleElem.textContent : 'Unknown Title';
      const artist = artistElem ? artistElem.textContent : 'Unknown Artist';
      const videoId = link ? extractVideoId(link.href) : '';

      if (!videoId) return;
      const clickedTrack = { title, artist, videoId };

      // Load the clicked track into the active deck
      if (activeDeckRef.current === 'A') {
        setTrackA(clickedTrack);
      } else {
        setTrackB(clickedTrack);
      }

      // Preload next track into the inactive deck if available
      const nextRow = row.nextElementSibling;
      if (nextRow) {
        const nextTitle = nextRow.querySelector('.title')?.textContent || 'Unknown Title';
        const nextArtist = nextRow.querySelector('.artist-name')?.textContent || 'Unknown Artist';
        const nextLink = nextRow.querySelector('a[href*="music.youtube.com"]');
        const nextVideoId = nextLink ? extractVideoId(nextLink.href) : '';
        const nextTrack = { title: nextTitle, artist: nextArtist, videoId: nextVideoId };

        if (activeDeckRef.current === 'A') {
          setTrackB(nextTrack);
        } else {
          setTrackA(nextTrack);
        }
      }
    }

    // 7) Crossfade from the active deck to the inactive deck.
    // Using local variables to avoid race conditions when manually triggering crossfade.
    function startCrossfade() {
      if (isCrossfading) return;
      setIsCrossfading(true);
      // Capture which deck is currently active and which will be the new active deck.
      const oldActive = activeDeckRef.current;
      const newActive = oldActive === 'A' ? 'B' : 'A';

      // Load the new track into the inactive deck.
      if (oldActive === 'A' && trackB && youtubePlayerBRef.current &&
          typeof youtubePlayerBRef.current.loadVideoById === 'function') {
        youtubePlayerBRef.current.loadVideoById(trackB.videoId);
      } else if (oldActive === 'B' && trackA && youtubePlayerARef.current &&
                 typeof youtubePlayerARef.current.loadVideoById === 'function') {
        youtubePlayerARef.current.loadVideoById(trackA.videoId);
      }

      const duration = 3000; // crossfade duration in ms
      const steps = 30;
      let stepCount = 0;

      const interval = setInterval(() => {
        stepCount++;
        const fadeOut = 100 - Math.round((100 * stepCount) / steps);
        const fadeIn = Math.round((100 * stepCount) / steps);

        // Use the captured deck values to adjust volumes.
        if (oldActive === 'A') {
          if (youtubePlayerARef.current) youtubePlayerARef.current.setVolume(fadeOut);
          if (youtubePlayerBRef.current) youtubePlayerBRef.current.setVolume(fadeIn);
          setVolumeA(fadeOut);
          setVolumeB(fadeIn);
        } else {
          if (youtubePlayerBRef.current) youtubePlayerBRef.current.setVolume(fadeOut);
          if (youtubePlayerARef.current) youtubePlayerARef.current.setVolume(fadeIn);
          setVolumeB(fadeOut);
          setVolumeA(fadeIn);
        }

        if (stepCount >= steps) {
          clearInterval(interval);
          finishCrossfade(oldActive, newActive);
        }
      }, duration / steps);
    }

    // 8) Cleanup after crossfade using the captured deck values.
    function finishCrossfade(oldActive, newActive) {
      if (oldActive === 'A') {
        if (youtubePlayerARef.current) youtubePlayerARef.current.stopVideo();
        setActiveDeck('B');
        setVolumeA(0);
        setVolumeB(100);
        setCurrentIndex(idx => {
          if (shuffle) {
            let newIndex = Math.floor(Math.random() * queue.length);
            if (queue.length > 1 && newIndex === idx) {
              newIndex = (newIndex + 1) % queue.length;
            }
            setTrackA(queue[newIndex]);
            return newIndex;
          } else {
            const newIndex = idx + 1;
            const nextTrack = queue[newIndex + 1];
            setTrackA(nextTrack ? nextTrack : null);
            return newIndex;
          }
        });
      } else {
        if (youtubePlayerBRef.current) youtubePlayerBRef.current.stopVideo();
        setActiveDeck('A');
        setVolumeB(0);
        setVolumeA(100);
        setCurrentIndex(idx => {
          if (shuffle) {
            let newIndex = Math.floor(Math.random() * queue.length);
            if (queue.length > 1 && newIndex === idx) {
              newIndex = (newIndex + 1) % queue.length;
            }
            setTrackB(queue[newIndex]);
            return newIndex;
          } else {
            const newIndex = idx + 1;
            const nextTrack = queue[newIndex + 1];
            setTrackB(nextTrack ? nextTrack : null);
            return newIndex;
          }
        });
      }
      setIsCrossfading(false);
    }

    // 9) When shuffle mode changes, automatically reset the decks.
    useEffect(() => {
      if (queue.length === 0) return;
      if (shuffle) {
        // For shuffle mode, randomly select new tracks for both decks.
        const randomIndexA = Math.floor(Math.random() * queue.length);
        let randomIndexB = Math.floor(Math.random() * queue.length);
        if (queue.length > 1 && randomIndexB === randomIndexA) {
          randomIndexB = (randomIndexB + 1) % queue.length;
        }
        if (activeDeck === 'A') {
          setTrackA(queue[randomIndexA]);
          setTrackB(queue[randomIndexB]);
          setCurrentIndex(randomIndexA);
        } else {
          setTrackB(queue[randomIndexA]);
          setTrackA(queue[randomIndexB]);
          setCurrentIndex(randomIndexA);
        }
      } else {
        // For sequential mode, keep the active track and load the next track in the inactive deck.
        if (activeDeck === 'A') {
          setTrackB(queue[currentIndex + 1] || null);
        } else {
          setTrackA(queue[currentIndex + 1] || null);
        }
      }
    }, [shuffle]);

    // Render the floating container, deck areas, and control buttons.
    return React.createElement(
      'div',
      {
        style: {
          position: 'fixed',
          bottom: '20px',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 40px',
          zIndex: 9999,
          backgroundColor: 'transparent',
          pointerEvents: 'none'
        }
      },
      // Deck A container
      React.createElement(
        'div',
        {
          onClick: () => {
            if (activeDeck !== 'A' && trackA) startCrossfade();
          },
          style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pointerEvents: 'auto' }
        },
        // Label changes: "Playing" if active, "Next" if inactive.
        React.createElement('h3', null, activeDeck === 'A' ? 'Playing' : 'Next'),
        React.createElement('div', {
          id: 'youtube-player-A',
          style: { border: '1px solid #fff', width: '320px', height: '180px' }
        }),
        trackA && React.createElement('p', null, trackA.title),
        React.createElement('p', { style: { fontSize: '0.8em', opacity: 0.7 } }, `Volume: ${volumeA}`)
      ),
      // Center control container for X-Fade and Shuffle buttons
      React.createElement(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'auto'
          }
        },
        React.createElement(
          'button',
          {
            onClick: startCrossfade,
            style: {
              margin: '0 20px',
              padding: '10px 15px',
              fontSize: '1em',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px'
            }
          },
          'X-Fade'
        ),
        React.createElement(
          'button',
          {
            onClick: () => setShuffle(!shuffle),
            style: {
              marginTop: '10px',
              padding: '10px 15px',
              fontSize: '1em',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px'
            }
          },
          `Shuffle: ${shuffle ? 'On' : 'Off'}`
        )
      ),
      // Deck B container
      React.createElement(
        'div',
        {
          onClick: () => {
            if (activeDeck !== 'B' && trackB) startCrossfade();
          },
          style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'auto' }
        },
        // Label changes: "Playing" if active, "Next" if inactive.
        React.createElement('h3', null, activeDeck === 'B' ? 'Playing' : 'Next'),
        React.createElement('div', {
          id: 'youtube-player-B',
          style: { border: '1px solid #fff', width: '320px', height: '180px' }
        }),
        trackB && React.createElement('p', null, trackB.title),
        React.createElement('p', { style: { fontSize: '0.8em', opacity: 0.7 } }, `Volume: ${volumeB}`)
      )
    );
  }

  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

window.addEventListener('load', initializePlayer);
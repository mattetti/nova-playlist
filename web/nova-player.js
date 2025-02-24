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

      // Playlist queue loaded from the DOM (for preloading purposes)
      const [queue, setQueue] = useState([]);
      const [currentIndex, setCurrentIndex] = useState(0);
      // Which deck is active: 'A' or 'B'
      const [activeDeck, setActiveDeck] = useState('A');

      // Volume states for crossfade
      const [volumeA, setVolumeA] = useState(100);
      const [volumeB, setVolumeB] = useState(0);

      // The current track for each deck
      const [trackA, setTrackA] = useState(null);
      const [trackB, setTrackB] = useState(null);

      // Flag to prevent multiple crossfades at once
      const [isCrossfading, setIsCrossfading] = useState(false);

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

          // Attach click listeners directly to each row
          entries.forEach(row => {
              row.addEventListener('click', handleRowClick);
          });
          // Cleanup listeners on unmount
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
                          ev.target.setVolume(volumeA);
                          if (trackA?.videoId && typeof ev.target.cueVideoById === 'function') {
                              ev.target.cueVideoById(trackA.videoId);
                          }
                      },
                      onStateChange: (ev) => {
                          // When deck A ends, if not already crossfading, trigger crossfade
                          if (ev.data === YT.PlayerState.ENDED && activeDeck === 'A' && trackB && !isCrossfading) {
                              startCrossfade();
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
                          ev.target.setVolume(volumeB);
                          if (trackB?.videoId && typeof ev.target.cueVideoById === 'function') {
                              ev.target.cueVideoById(trackB.videoId);
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
      }, []); // One-time initialization

      // 3) Update deck A when trackA changes.
      // If deck A is active, load and play; otherwise, cue the video.
      useEffect(() => {
          if (youtubePlayerARef.current && trackA?.videoId) {
              if (activeDeck === 'A') {
                  if (typeof youtubePlayerARef.current.loadVideoById === 'function') {
                      youtubePlayerARef.current.loadVideoById(trackA.videoId);
                  }
              } else {
                  if (typeof youtubePlayerARef.current.cueVideoById === 'function') {
                      youtubePlayerARef.current.cueVideoById(trackA.videoId);
                  }
              }
          }
      }, [trackA, activeDeck]);

      // 4) Update deck B when trackB changes.
      // If deck B is active, load and play; otherwise, cue the video.
      useEffect(() => {
          if (youtubePlayerBRef.current && trackB?.videoId) {
              if (activeDeck === 'B') {
                  if (typeof youtubePlayerBRef.current.loadVideoById === 'function') {
                      youtubePlayerBRef.current.loadVideoById(trackB.videoId);
                  }
              } else {
                  if (typeof youtubePlayerBRef.current.cueVideoById === 'function') {
                      youtubePlayerBRef.current.cueVideoById(trackB.videoId);
                  }
              }
          }
      }, [trackB, activeDeck]);

      // 5) Check every second if active deck is within 3 seconds of track end
      useEffect(() => {
          const checkInterval = setInterval(() => {
              if (isCrossfading) return;
              const player = activeDeck === 'A' ? youtubePlayerARef.current : youtubePlayerBRef.current;
              if (
                  player &&
                  typeof player.getCurrentTime === 'function' &&
                  typeof player.getDuration === 'function'
              ) {
                  const currentTime = player.getCurrentTime();
                  const duration = player.getDuration();
                  if (duration > 0 && (duration - currentTime <= 3)) {
                      startCrossfade();
                  }
              }
          }, 1000);
          return () => clearInterval(checkInterval);
      }, [activeDeck, isCrossfading, trackA, trackB]);

      // 6) Handle row clicks by extracting track info from the row DOM
      function handleRowClick(e) {
          // Ignore clicks on actual <a> links
          if (e.target.tagName.toLowerCase() === 'a') return;
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
          if (activeDeck === 'A') {
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

              if (activeDeck === 'A') {
                  setTrackB(nextTrack);
              } else {
                  setTrackA(nextTrack);
              }
          }
      }

      // 7) Crossfade from the active deck to the inactive deck
      function startCrossfade() {
          if (isCrossfading) return;
          setIsCrossfading(true);
          const duration = 3000; // crossfade duration in ms
          const steps = 30;
          let stepCount = 0;

          const interval = setInterval(() => {
              stepCount++;
              const fadeOut = 100 - Math.round((100 * stepCount) / steps);
              const fadeIn = Math.round((100 * stepCount) / steps);

              if (activeDeck === 'A') {
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
                  finishCrossfade();
              }
          }, duration / steps);
      }

      // 8) Cleanup after crossfade: stop the fading deck, swap active deck, and preload the next track without auto-playing
      function finishCrossfade() {
          if (activeDeck === 'A') {
              if (youtubePlayerARef.current) youtubePlayerARef.current.stopVideo();
              setActiveDeck('B');
              setVolumeA(0);
              setVolumeB(100);

              // Preload the next track into deck A (cue it so it doesn't auto-play)
              setCurrentIndex(idx => {
                  const newIndex = idx + 1;
                  const nextTrack = queue[newIndex + 1];
                  if (nextTrack) {
                      setTrackA(nextTrack);
                  } else {
                      setTrackA(null);
                  }
                  return newIndex;
              });
          } else {
              if (youtubePlayerBRef.current) youtubePlayerBRef.current.stopVideo();
              setActiveDeck('A');
              setVolumeB(0);
              setVolumeA(100);

              setCurrentIndex(idx => {
                  const newIndex = idx + 1;
                  const nextTrack = queue[newIndex + 1];
                  if (nextTrack) {
                      setTrackB(nextTrack);
                  } else {
                      setTrackB(null);
                  }
                  return newIndex;
              });
          }
          setIsCrossfading(false);
      }

      // Render the component with a floating container that passes through pointer events.
      // Also, add onClick handlers on the deck areas: clicking on a non-active deck triggers crossfade.
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
              React.createElement('h3', null, 'Deck A'),
              React.createElement('div', {
                  id: 'youtube-player-A',
                  style: { border: '1px solid #fff', width: '320px', height: '180px' }
              }),
              trackA && React.createElement('p', null, trackA.title),
              React.createElement('p', { style: { fontSize: '0.8em', opacity: 0.7 } }, `Volume: ${volumeA}`)
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
              React.createElement('h3', null, 'Deck B'),
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

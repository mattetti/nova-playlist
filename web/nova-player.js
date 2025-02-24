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
                          if (trackA?.videoId) {
                              ev.target.cueVideoById(trackA.videoId);
                          }
                      },
                      onStateChange: (ev) => {
                          // When deck A ends, crossfade to deck B
                          if (ev.data === YT.PlayerState.ENDED && activeDeck === 'A' && trackB) {
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
                          if (trackB?.videoId) {
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
      }, []); // Empty dependency to ensure one-time initialization

      // 3) Update deck A when trackA changes
      useEffect(() => {
          if (
              youtubePlayerARef.current &&
              trackA?.videoId &&
              typeof youtubePlayerARef.current.loadVideoById === 'function'
          ) {
              youtubePlayerARef.current.loadVideoById(trackA.videoId);
          }
      }, [trackA]);

      // 4) Update deck B when trackB changes
      useEffect(() => {
          if (
              youtubePlayerBRef.current &&
              trackB?.videoId &&
              typeof youtubePlayerBRef.current.loadVideoById === 'function'
          ) {
              youtubePlayerBRef.current.loadVideoById(trackB.videoId);
          }
      }, [trackB]);

      // 5) Handle row clicks by extracting track info from the row DOM
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

      // 6) Crossfade from the active deck to the inactive deck
      function startCrossfade() {
          const duration = 3000; // total crossfade duration in ms
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

      // 7) Cleanup after crossfade: stop the old deck and swap active deck
      function finishCrossfade() {
          if (activeDeck === 'A') {
              if (youtubePlayerARef.current) youtubePlayerARef.current.stopVideo();
              setActiveDeck('B');
              setVolumeA(0);
              setVolumeB(100);

              // Advance the queue: preload the next track into deck A
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
      }

      // Render the component with a floating container that passes through pointer events
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
                  pointerEvents: 'none' // Allow clicks outside child elements to pass through
              }
          },
          // Deck A container (pointer events enabled)
          React.createElement(
              'div',
              { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', pointerEvents: 'auto' } },
              React.createElement('h3', null, 'Deck A'),
              React.createElement('div', {
                  id: 'youtube-player-A',
                  style: { border: '1px solid #fff', width: '320px', height: '180px' }
              }),
              trackA && React.createElement('p', null, trackA.title),
              React.createElement('p', { style: { fontSize: '0.8em', opacity: 0.7 } }, `Volume: ${volumeA}`)
          ),
          // Deck B container (pointer events enabled)
          React.createElement(
              'div',
              { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', pointerEvents: 'auto' } },
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
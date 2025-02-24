function waitForLibraries() {
  return new Promise((resolve) => {
    function checkLibraries() {
      if (window.React && window.ReactDOM && window.lucide && window.YT) {
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

  const extractVideoId = (url) => {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : '';
  };

  function NovaPlayer() {
    const youtubePlayerARef = useRef(null);
    const youtubePlayerBRef = useRef(null);

    // Tracks for each deck
    const [trackA, setTrackA] = useState(null);
    const [trackB, setTrackB] = useState(null);

    // Load tracks from .playlist-entry on mount
    useEffect(() => {
      const entries = document.querySelectorAll('.playlist-entry');
      if (!entries.length) return;

      // For demo, just pick first two tracks
      const track1El = entries[0];
      const track2El = entries[1];
      if (track1El) {
        const link = track1El.querySelector('a[href*="music.youtube.com"]');
        setTrackA({
          videoId: extractVideoId(link.href),
          title: track1El.querySelector('.title')?.textContent ?? 'Unknown'
        });
      }
      if (track2El) {
        const link = track2El.querySelector('a[href*="music.youtube.com"]');
        setTrackB({
          videoId: extractVideoId(link.href),
          title: track2El.querySelector('.title')?.textContent ?? 'Unknown'
        });
      }
    }, []);

    // Initialize Deck A & Deck B
    useEffect(() => {
      const initDeckA = () => {
        youtubePlayerARef.current = new YT.Player('youtube-player-A', {
          height: '180',
          width: '320',
          videoId: '',
          playerVars: { controls: 1 },
          events: {
            onReady: () => {
              // Preload the first track once deck A is ready
              if (trackA?.videoId) {
                youtubePlayerARef.current.cueVideoById(trackA.videoId);
              }
            }
          }
        });
      };

      const initDeckB = () => {
        youtubePlayerBRef.current = new YT.Player('youtube-player-B', {
          height: '180',
          width: '320',
          videoId: '',
          playerVars: { controls: 1 }
        });
      };

      // If YT is already loaded, init immediately
      if (window.YT && window.YT.Player) {
        initDeckA();
        initDeckB();
      } else {
        window.onYouTubeIframeAPIReady = () => {
          initDeckA();
          initDeckB();
        };
      }
    }, [trackA, trackB]);

    return React.createElement(
      'div',
      {
        id: 'nova-player-root',
        style: {
          // Transparent, floating container
          position: 'fixed',
          bottom: '20px',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0 40px',
          zIndex: 9999,
          backgroundColor: 'transparent'
        }
      },
      // Deck A on the left
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start' } },
        React.createElement('h3', null, 'Deck A'),
        React.createElement('div', {
          id: 'youtube-player-A',
          style: { border: '1px solid #fff', width: '320px', height: '180px' }
        }),
        trackA && React.createElement('p', null, trackA.title)
      ),
      // Deck B on the right
      React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } },
        React.createElement('h3', null, 'Deck B'),
        React.createElement('div', {
          id: 'youtube-player-B',
          style: { border: '1px solid #fff', width: '320px', height: '180px' }
        }),
        trackB && React.createElement('p', null, trackB.title)
      )
    );
  }

  // Render the NovaPlayer
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

window.addEventListener('load', initializePlayer);

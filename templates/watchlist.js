let watchList = [];

function initWatchlistPage() {
    console.log("Initializing Watchlist Page");
    // Add event listeners for the new UI elements
    const addButton = document.getElementById('watch-add-btn');
    const urlInput = document.getElementById('watch-url-input');

    addButton.addEventListener('click', handleAddWatchItem);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAddWatchItem();
        }
    });

    loadWatchlist();
}

async function loadWatchlist() {
    try {
        const response = await fetch('/api/watchlist/state');
        const data = await response.json();
        watchList = data.items || [];
        renderWatchlist();
    } catch (error) {
        console.error('Error loading watchlist:', error);
    }
}

function renderWatchlist() {
    const listEl = document.getElementById('watch-list');
    const emptyEl = document.getElementById('watch-empty');
    const countEl = document.getElementById('watch-count');
    const badgeEl = document.getElementById('watch-badge');

    // TODO: Implement rendering logic
    console.log("Rendering watchlist with items:", watchList);

    if (watchList.length === 0) {
        emptyEl.style.display = 'block';
    } else {
        emptyEl.style.display = 'none';
    }
}

function handleAddWatchItem() {
    console.log("Add button clicked");
    // TODO: Implement logic to add a new item
}
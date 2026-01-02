// Chess Analysis Report JavaScript

// Toggle variations for opening analysis
function toggleVariations(id) {
    var element = document.getElementById(id);
    if (element.style.display === 'none' || element.style.display === '') {
        element.style.display = 'table-row';
    } else {
        element.style.display = 'none';
    }
}

// Toggle additional openings
function toggleAdditionalOpenings() {
    var openingRows = document.querySelectorAll('.additional-openings.opening-row');
    var variationRows = document.querySelectorAll('.additional-openings.variations-row');
    var showMoreRow = document.querySelector('.show-more-row');
    var showFewerRow = document.querySelector('.show-fewer-row');

    if (openingRows.length === 0) return;

    var isHidden = openingRows[0].style.display === 'none' || openingRows[0].style.display === '';

    // Show/hide the main opening rows
    openingRows.forEach(function(element) {
        element.style.display = isHidden ? 'table-row' : 'none';
    });

    // Always hide variation rows when toggling (keep them collapsed)
    variationRows.forEach(function(element) {
        element.style.display = 'none';
    });

    // Toggle the buttons
    if (isHidden) {
        // Show additional openings
        if (showMoreRow) showMoreRow.style.display = 'none';
        if (showFewerRow) showFewerRow.style.display = 'table-row';
    } else {
        // Hide additional openings
        if (showMoreRow) {
            showMoreRow.style.display = 'table-row';
            showMoreRow.innerHTML = '<td colspan="7"><strong>Show ' + openingRows.length + ' more openings...</strong></td>';
        }
        if (showFewerRow) showFewerRow.style.display = 'none';
    }
}

// Create termination pie charts
function createTerminationCharts() {
    var terminationsDataElement = document.getElementById('terminationsData');
    if (!terminationsDataElement) return;

    try {
        var data = JSON.parse(terminationsDataElement.textContent);
        console.log('Terminations data:', data);

        // Chess-themed colors
        var colors = [
            '#2c4a7a',  // Primary blue
            '#4a6ba3',  // Light blue
            '#d4af37',  // Gold
            '#e6c758',  // Light gold
            '#1e3355',  // Dark blue
            '#b8941f',  // Dark gold
            '#6c757d',  // Gray
            '#495057'   // Dark gray
        ];

        // Create White Wins pie chart
        if (data.whiteWins && Object.keys(data.whiteWins).length > 0) {
            console.log('Creating White Wins chart with data:', data.whiteWins);
            createPieChart('whiteWins', 'How I Win as White', data.whiteWins, colors);
        } else {
            console.log('No White Wins data or empty data:', data.whiteWins);
        }

        // Create White Losses pie chart
        if (data.whiteLosses && Object.keys(data.whiteLosses).length > 0) {
            console.log('Creating White Losses chart with data:', data.whiteLosses);
            createPieChart('whiteLosses', 'How I Lose as White', data.whiteLosses, colors);
        } else {
            console.log('No White Losses data or empty data:', data.whiteLosses);
        }

        // Create Black Wins pie chart
        if (data.blackWins && Object.keys(data.blackWins).length > 0) {
            console.log('Creating Black Wins chart with data:', data.blackWins);
            createPieChart('blackWins', 'How I Win as Black', data.blackWins, colors);
        } else {
            console.log('No Black Wins data or empty data:', data.blackWins);
        }

        // Create Black Losses pie chart
        if (data.blackLosses && Object.keys(data.blackLosses).length > 0) {
            console.log('Creating Black Losses chart with data:', data.blackLosses);
            createPieChart('blackLosses', 'How I Lose as Black', data.blackLosses, colors);
        } else {
            console.log('No Black Losses data or empty data:', data.blackLosses);
        }
    } catch (error) {
        console.error('Error parsing terminations data:', error);
    }
}

function createPieChart(canvasId, title, data, colors) {
    console.log('createPieChart called with:', canvasId, title, data);
    var ctx = document.getElementById(canvasId);
    if (!ctx) {
        console.error('Canvas element not found:', canvasId);
        return;
    }
    console.log('Canvas element found:', ctx);

    var labels = Object.keys(data);
    var values = Object.values(data);
    console.log('Chart data - labels:', labels, 'values:', values);

    // Filter out zero values
    var filteredData = [];
    var filteredLabels = [];
    var filteredColors = [];

    for (var i = 0; i < labels.length; i++) {
        if (values[i] > 0) {
            filteredData.push(values[i]);
            filteredLabels.push(labels[i]);
            filteredColors.push(colors[i % colors.length]);
        }
    }

    console.log('Filtered data:', filteredData, 'labels:', filteredLabels);
    if (filteredData.length === 0) {
        console.log('No data to display for chart:', canvasId);
        // Replace canvas with a message
        var noDataMsg = document.createElement('p');
        noDataMsg.style.textAlign = 'center';
        noDataMsg.style.color = 'var(--text-secondary)';
        noDataMsg.style.fontStyle = 'italic';
        noDataMsg.style.margin = '50px 0';
        noDataMsg.textContent = 'No data available - generate a new report to see charts';
        ctx.parentElement.replaceChild(noDataMsg, ctx);
        return;
    }

    console.log('Creating Chart.js chart for:', canvasId);
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: filteredLabels,
            datasets: [{
                data: filteredData,
                backgroundColor: filteredColors,
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        font: {
                            size: 10
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);
                            var percentage = Math.round((context.parsed * 100) / total);
                            return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                        }
                    }
                }
            }
        }
    });
}

// Chess opening data and board states
var openingData = {};
var boardStates = {};

// Load opening data from TSV files
async function loadOpeningData() {
    const files = ['a', 'b', 'c', 'd', 'e'];

    for (const file of files) {
        try {
            const response = await fetch(`/static/data/openings/${file}.tsv`);
            const text = await response.text();
            parseOpeningTSV(text);
        } catch (error) {
            console.error(`Failed to load ${file}.tsv:`, error);
        }
    }

    console.log('Loaded opening data for', Object.keys(openingData).length, 'openings');
}

// Parse TSV data into opening data structure
function parseOpeningTSV(tsvText) {
    const lines = tsvText.trim().split('\n');

    for (let i = 1; i < lines.length; i++) { // Skip header row
        const columns = lines[i].split('\t');
        if (columns.length >= 3) {
            const eco = columns[0];
            const name = columns[1];
            const moves = columns[2];

            // Store opening data
            if (!openingData[name]) {
                openingData[name] = {
                    eco: eco,
                    moves: moves,
                    pgn: moves
                };
            }
        }
    }
}

// Initialize all chess boards on the page
function initializeChessBoards() {
    const boardElements = document.querySelectorAll('.chess-board-small');
    console.log('Found', boardElements.length, 'board elements to initialize');

    boardElements.forEach(function(element) {
        const boardId = element.id;
        const openingName = element.getAttribute('data-opening');
        console.log('Initializing board:', boardId, 'for opening:', openingName);

        // Check if element exists and has proper dimensions
        console.log('Element dimensions:', element.offsetWidth, 'x', element.offsetHeight);

        // Create Chess.js instance
        const chess = new Chess();

        try {
            // Create Chessboard.js instance
            const board = Chessboard(boardId, {
                position: 'start',
                pieceTheme: '/static/images/chesspieces/default/{piece}.svg',
                showNotation: false,
                draggable: false
            });

            console.log('Successfully created board for:', boardId);

            // Store board state
            boardStates[boardId] = {
                chess: chess,
                board: board,
                opening: openingName,
                moves: [],
                currentMove: 0
            };

            // Load opening moves
            loadOpeningMoves(boardId, openingName);
        } catch (error) {
            console.error('Failed to create board for', boardId, ':', error);
        }
    });
}

// Load moves for a specific opening
function loadOpeningMoves(boardId, openingName) {
    console.log('loadOpeningMoves called with boardId:', boardId, 'openingName:', openingName);
    const boardState = boardStates[boardId];
    if (!boardState) {
        console.error('Board state not found in loadOpeningMoves for:', boardId);
        return;
    }

    // Find opening data
    let moves = '';
    console.log('Available opening data keys:', Object.keys(openingData).slice(0, 10)); // Show first 10
    console.log('Looking for opening:', openingName);

    if (openingData[openingName]) {
        moves = openingData[openingName].moves;
        console.log('Found moves for opening:', openingName, '- moves:', moves);
    } else {
        console.warn('Opening not found in openingData. Available openings:', Object.keys(openingData).filter(key => key.includes(openingName.substring(0, 10))));
    }

    if (moves) {
        // Parse moves and store them
        const moveList = moves.split(' ').filter(move => move.trim() && !move.includes('.'));
        boardState.moves = moveList;

        console.log(`Loaded ${moveList.length} moves for ${openingName}:`, moveList);

        // Automatically play all moves to show the final opening position
        playAllMovesToEnd(boardId);
    } else {
        console.warn('No moves found for opening:', openingName);
        console.log('Setting empty moves array');
        boardState.moves = [];
    }
}

// Play all moves to show the final opening position
function playAllMovesToEnd(boardId) {
    const boardState = boardStates[boardId];
    if (!boardState || !boardState.moves.length) return;

    try {
        // Play each move in sequence
        for (let i = 0; i < boardState.moves.length; i++) {
            const move = boardState.moves[i];
            const result = boardState.chess.move(move);
            if (!result) {
                console.error(`Invalid move ${move} at position ${i} for ${boardId}`);
                break;
            }
        }

        // Update the board position to show the final opening position
        boardState.board.position(boardState.chess.fen());
        boardState.currentMove = boardState.moves.length;

        console.log(`${boardId}: Showing final opening position at move ${boardState.currentMove}`);
    } catch (error) {
        console.error(`Error playing moves for ${boardId}:`, error);
    }
}

// Navigation functions for chess boards
function nextMove(boardId) {
    const boardState = boardStates[boardId];
    if (!boardState || boardState.currentMove >= boardState.moves.length) {
        console.log(`${boardId}: Already at final position`);
        return;
    }

    const move = boardState.moves[boardState.currentMove];
    try {
        const result = boardState.chess.move(move);
        if (result) {
            boardState.board.position(boardState.chess.fen());
            boardState.currentMove++;
            console.log(`${boardId}: Applied move ${boardState.currentMove}/${boardState.moves.length}: ${move}`);
        }
    } catch (error) {
        console.error(`Invalid move ${move} for ${boardId}:`, error);
    }
}

function previousMove(boardId) {
    const boardState = boardStates[boardId];
    if (!boardState || boardState.currentMove <= 0) return;

    boardState.chess.undo();
    boardState.board.position(boardState.chess.fen());
    boardState.currentMove--;
    console.log(`${boardId}: Undid move, now at ${boardState.currentMove}/${boardState.moves.length}`);
}

function resetBoard(boardId) {
    const boardState = boardStates[boardId];
    if (!boardState) return;

    // Reset to starting position first
    boardState.chess.reset();
    boardState.currentMove = 0;

    // Then play all moves to show the final opening position again
    playAllMovesToEnd(boardId);
    console.log(`${boardId}: Reset to final opening position`);
}

// Create results bar charts using Chart.js
function createResultsCharts() {
    const chartElements = document.querySelectorAll('.results-chart');
    console.log('Found', chartElements.length, 'result chart elements to initialize');

    chartElements.forEach(function(element) {
        const chartId = element.id;
        const wins = parseInt(element.getAttribute('data-wins')) || 0;
        const draws = parseInt(element.getAttribute('data-draws')) || 0;
        const losses = parseInt(element.getAttribute('data-losses')) || 0;

        // Skip if no data
        if (wins + draws + losses === 0) {
            console.log('Skipping chart with no data:', chartId);
            return;
        }

        try {
            new Chart(element, {
                type: 'bar',
                data: {
                    labels: ['Results'],
                    datasets: [
                        {
                            label: 'Wins',
                            data: [wins],
                            backgroundColor: '#28a745',
                            borderColor: '#28a745',
                            borderWidth: 0
                        },
                        {
                            label: 'Draws',
                            data: [draws],
                            backgroundColor: '#fd7e14',
                            borderColor: '#fd7e14',
                            borderWidth: 0
                        },
                        {
                            label: 'Losses',
                            data: [losses],
                            backgroundColor: '#dc3545',
                            borderColor: '#dc3545',
                            borderWidth: 0
                        }
                    ]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const total = wins + draws + losses;
                                    const percentage = Math.round((context.parsed.x / total) * 100);
                                    return context.dataset.label + ': ' + context.parsed.x + ' (' + percentage + '%)';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            display: false
                        },
                        y: {
                            stacked: true,
                            display: false
                        }
                    }
                }
            });

            console.log('Created results chart for:', chartId, 'with data:', wins, draws, losses);
        } catch (error) {
            console.error('Failed to create chart for', chartId, ':', error);
        }
    });
}

// Store original opening data for restoration
var originalOpeningData = {};

// Handle variant selection with highlighting only
function selectVariant(variantElement) {
    console.log('selectVariant called with element:', variantElement);

    // Update active state
    const variantOptions = variantElement.parentElement;
    const allOptions = variantOptions.querySelectorAll('.variant-option');

    // Remove active class from all options
    allOptions.forEach(option => option.classList.remove('active'));

    // Add active class to selected option
    variantElement.classList.add('active');

    // Get data from the elements
    const openingId = variantOptions.getAttribute('data-opening-id');
    const boardId = variantOptions.getAttribute('data-board-id');

    // Properly decode HTML entities and parse JSON
    const rawJson = variantOptions.getAttribute('data-variations');
    console.log('Raw JSON:', rawJson);

    // Create a temporary element to decode HTML entities
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = rawJson;
    const decodedJson = tempDiv.textContent || tempDiv.innerText || '';
    console.log('Decoded JSON:', decodedJson);

    let variationsData;
    try {
        variationsData = JSON.parse(decodedJson);
    } catch (error) {
        console.error('JSON parse error:', error);
        console.error('Problematic JSON:', decodedJson);
        return;
    }

    const selectedVariant = variantElement.getAttribute('data-variant').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

    console.log('Selected variant:', selectedVariant, 'Opening ID:', openingId, 'Board ID:', boardId);

    // Call the update function
    updateOpeningForVariant(openingId, boardId, variationsData, selectedVariant);
}

// Update opening display for selected variant
function updateOpeningForVariant(openingId, boardId, variationsData, selectedVariant) {

    console.log('Updating opening for variant:', selectedVariant, 'Board ID:', boardId);

    // Find the opening row - look for the opening row above the variations row
    const variationsRow = document.querySelector(`#variations-${openingId}`);
    const openingRow = variationsRow ? variationsRow.previousElementSibling : null;
    if (!openingRow) {
        console.error('Could not find opening row');
        return;
    }

    // Store original data if not already stored
    if (!originalOpeningData[openingId]) {
        const resultsBarCell = openingRow.querySelector('.results-bar-cell');
        const successRateCell = openingRow.querySelector('.success-rate');
        const openingNameCell = openingRow.querySelector('td:first-child');

        if (resultsBarCell && successRateCell && openingNameCell) {
            originalOpeningData[openingId] = {
                resultsBarHTML: resultsBarCell.innerHTML,
                successRateHTML: successRateCell.innerHTML,
                openingName: openingNameCell.innerHTML
            };
        }
    }

    // If "All Variations Combined" is selected, restore original data
    if (!variationsData[selectedVariant]) {
        if (originalOpeningData[openingId]) {
            const resultsBarCell = openingRow.querySelector('.results-bar-cell');
            const successRateCell = openingRow.querySelector('.success-rate');
            const openingNameCell = openingRow.querySelector('td:first-child');

            if (resultsBarCell) resultsBarCell.innerHTML = originalOpeningData[openingId].resultsBarHTML;
            if (successRateCell) successRateCell.innerHTML = originalOpeningData[openingId].successRateHTML;
            if (openingNameCell) openingNameCell.innerHTML = originalOpeningData[openingId].openingName;
        }

        // Update chess board to show the main opening
        updateChessBoardForOpening(boardId, selectedVariant);
        return;
    }

    // Get variant data
    const variantData = variationsData[selectedVariant];
    const wins = variantData.wins;
    const draws = variantData.draws;
    const losses = variantData.losses;
    const total = variantData.total;
    const successRate = variantData.success_rate;

    // Calculate percentages
    const winPct = total > 0 ? Math.round((wins / total) * 100 * 10) / 10 : 0;
    const drawPct = total > 0 ? Math.round((draws / total) * 100 * 10) / 10 : 0;
    const lossPct = total > 0 ? Math.round((losses / total) * 100 * 10) / 10 : 0;

    // Update results bar
    const resultsBarCell = openingRow.querySelector('.results-bar-cell');
    if (resultsBarCell) {
        resultsBarCell.innerHTML = `
            <div class="results-bar-container">
                <div class="results-bar-simple" style="width: 150px; height: 16px;">
                    <div class="bar-win" style="width: ${winPct}%; background: #28a745;" title="Wins: ${wins}"></div>
                    <div class="bar-draw" style="width: ${drawPct}%; background: #fd7e14;" title="Draws: ${draws}"></div>
                    <div class="bar-loss" style="width: ${lossPct}%; background: #dc3545;" title="Losses: ${losses}"></div>
                </div>
                <div class="results-text">${wins}W ${draws}D ${losses}L</div>
            </div>
        `;
    }

    // Update success rate
    const successRateCell = openingRow.querySelector('.success-rate');
    if (successRateCell) {
        // Determine success rate color class
        let successClass = 'success-poor';
        if (successRate >= 60) successClass = 'success-good';
        else if (successRate >= 45) successClass = 'success-ok';

        successRateCell.className = `success-rate ${successClass}`;
        successRateCell.innerHTML = `<strong>${successRate}%</strong>`;
    }

    // Update opening name to show current variant
    const openingNameCell = openingRow.querySelector('td:first-child');
    if (openingNameCell && originalOpeningData[openingId]) {
        const originalName = originalOpeningData[openingId].openingName;
        const baseName = originalName.split(' (')[0].replace(/<\/?strong>/g, '');
        openingNameCell.innerHTML = `<strong>${baseName}</strong><br><em style="color: var(--text-secondary); font-size: 0.9em;">${selectedVariant}</em>`;
    }

    // Update chess board to show the selected variant
    updateChessBoardForOpening(boardId, selectedVariant);
}

// Update chess board for a specific opening/variant
function updateChessBoardForOpening(boardId, openingName) {
    console.log('updateChessBoardForOpening called with boardId:', boardId, 'openingName:', openingName);
    console.log('Available board states:', Object.keys(boardStates));

    const boardState = boardStates[boardId];
    if (!boardState) {
        console.error('Board state not found for:', boardId);
        console.error('Available boards:', Object.keys(boardStates));
        return;
    }

    console.log('Found board state, updating for opening:', openingName);

    // Reset the board and chess state
    boardState.chess.reset();
    boardState.currentMove = 0;
    boardState.opening = openingName;

    // Load moves for the new opening
    loadOpeningMoves(boardId, openingName);
}

// Initialize page when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    console.log('Chess Analysis Report loaded');

    // Create termination charts if Chart.js is available
    if (typeof Chart !== 'undefined') {
        console.log('Chart.js is available, version:', Chart.version);
        createTerminationCharts();
    } else {
        console.error('Chart.js is not loaded!');
    }

    // Initialize chess boards if libraries are available
    if (typeof Chess !== 'undefined' && typeof Chessboard !== 'undefined') {
        console.log('Chess libraries loaded, initializing boards...');
        console.log('Chess.js available:', typeof Chess);
        console.log('Chessboard.js available:', typeof Chessboard);

        loadOpeningData().then(() => {
            console.log('Opening data loaded, waiting for DOM...');
            // Wait a bit longer for DOM to be fully ready
            setTimeout(() => {
                console.log('Attempting to initialize chess boards...');
                initializeChessBoards();
            }, 1000);
        });
    } else {
        console.error('Chess libraries not loaded!');
        console.log('Chess available:', typeof Chess);
        console.log('Chessboard available:', typeof Chessboard);
    }

    // Add click handlers for both show-more and show-fewer buttons
    var showMoreRows = document.querySelectorAll('.show-more-row');
    showMoreRows.forEach(function(row) {
        row.addEventListener('click', toggleAdditionalOpenings);
    });

    var showFewerRows = document.querySelectorAll('.show-fewer-row');
    showFewerRows.forEach(function(row) {
        row.addEventListener('click', toggleAdditionalOpenings);
    });
});
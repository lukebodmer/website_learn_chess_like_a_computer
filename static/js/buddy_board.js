/* Buddy Board Widget JavaScript */

// Buddy Board State Management
class BuddyBoard {
    constructor() {
        this.isExpanded = false;
        this.currentGame = null;
        this.currentMoveIndex = 0;
        this.moves = [];
        this.board = null;
        this.chess = null;
        this.games = [];
        this.allGames = []; // Store original complete games list
        this.analysisVisible = true;


        this.initializeElements();
        this.bindEvents();
        this.loadGamesData();
        this.initializeBoard();
    }

    initializeElements() {
        // Main elements
        this.widget = document.getElementById('buddy-board-widget');
        this.panel = document.getElementById('buddy-board-panel');
        this.overlay = document.getElementById('buddy-board-overlay');

        // Control buttons
        this.toggleBtn = document.getElementById('buddy-board-toggle');
        this.minimizeBtn = document.getElementById('buddy-board-minimize');
        this.closeBtn = document.getElementById('buddy-board-close');

        // Game selector
        this.gameSelect = document.getElementById('buddy-game-select');
        this.gameInfo = document.getElementById('buddy-game-info');
        this.gameDetails = document.getElementById('buddy-game-details');
        this.gameResult = document.getElementById('buddy-game-result');

        // Navigation buttons
        this.firstMoveBtn = document.getElementById('buddy-first-move');
        this.prevMoveBtn = document.getElementById('buddy-prev-move');
        this.nextMoveBtn = document.getElementById('buddy-next-move');
        this.lastMoveBtn = document.getElementById('buddy-last-move');
        this.moveCounter = document.getElementById('buddy-move-counter');

        // Moves list
        this.movesSection = document.getElementById('buddy-board-moves');
        this.movesToggleBtn = document.getElementById('buddy-toggle-moves');
        this.movesList = document.getElementById('buddy-moves-list');

        // Analysis section
        this.analysisHeader = document.querySelector('.analysis-header');
        this.analysisToggleBtn = document.getElementById('buddy-toggle-analysis');
        this.evaluationSidebar = document.getElementById('buddy-evaluation-sidebar');
        this.evalBar = document.getElementById('buddy-eval-bar');
        this.evalText = document.getElementById('buddy-eval-text');

        // Status
        this.statusText = document.getElementById('buddy-status-text');
    }

    bindEvents() {
        // Widget toggle
        this.toggleBtn.addEventListener('click', () => this.expand());
        this.minimizeBtn.addEventListener('click', () => this.minimize());
        this.closeBtn.addEventListener('click', () => this.close());

        // Game selection
        this.gameSelect.addEventListener('change', (e) => this.loadGame(e.target.value));

        // Navigation
        this.firstMoveBtn.addEventListener('click', () => this.goToFirstMove());
        this.prevMoveBtn.addEventListener('click', () => this.previousMove());
        this.nextMoveBtn.addEventListener('click', () => this.nextMove());
        this.lastMoveBtn.addEventListener('click', () => this.goToMove(this.moves.length));

        // Moves list is always visible - remove toggle functionality

        // Analysis is always visible - remove toggle functionality

        // Overlay click to close
        this.overlay.addEventListener('click', () => this.close());

        // Prevent panel clicks from closing
        this.panel.addEventListener('click', (e) => e.stopPropagation());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isExpanded) {
                this.close();
            }
        });
    }

    loadGamesData() {
        try {
            const gamesDataElement = document.getElementById('buddy-board-games-data');
            if (gamesDataElement) {
                const gamesJson = gamesDataElement.textContent.trim();
                this.allGames = JSON.parse(gamesJson || '[]');
                this.games = [...this.allGames]; // Copy all games to current games
                this.populateGameSelector();
                console.log('Loaded', this.games.length, 'games for buddy board');
            }
        } catch (error) {
            console.error('Error loading games data:', error);
            this.updateStatus('Error loading games data');
        }
    }

    populateGameSelector() {
        // Clear existing options except the first
        while (this.gameSelect.children.length > 1) {
            this.gameSelect.removeChild(this.gameSelect.lastChild);
        }

        // Add games to selector
        this.games.forEach((game, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${game.white} vs ${game.black} (${game.date})`;
            this.gameSelect.appendChild(option);
        });

        this.updateStatus(`Ready - ${this.games.length} games available`);
    }

    initializeBoard() {
        if (typeof Chessboard === 'undefined' || typeof Chess === 'undefined') {
            console.error('Chess libraries not loaded');
            this.updateStatus('Chess libraries not available');
            return;
        }

        try {
            // Initialize Chess.js
            this.chess = new Chess();

            // Initialize Chessboard.js - use default settings like the examples
            this.board = Chessboard('buddy-chess-board', {
                position: 'start',
                pieceTheme: '/static/images/chesspieces/default/{piece}.svg',
                showNotation: false,
                draggable: false
            });

            console.log('Buddy board initialized successfully');
        } catch (error) {
            console.error('Error initializing buddy board:', error);
            this.updateStatus('Error initializing chess board');
        }
    }

    expand() {
        if (this.isExpanded) return;

        this.isExpanded = true;
        this.widget.style.display = 'none';
        this.panel.style.display = 'flex';

        // Show overlay on mobile
        if (window.innerWidth <= 768) {
            this.overlay.style.display = 'block';
        }

        this.updatePanelWidth();
        this.updateStatus('Buddy board opened');
    }

    minimize() {
        if (!this.isExpanded) return;

        this.isExpanded = false;
        this.panel.style.display = 'none';
        this.overlay.style.display = 'none';
        this.widget.style.display = 'block';

        this.updateStatus('Buddy board minimized');
    }

    close() {
        this.minimize();
    }

    loadGame(gameIndex) {
        if (gameIndex === '' || !this.games[gameIndex]) {
            this.currentGame = null;
            this.moves = [];
            this.currentMoveIndex = 0;
            this.gameInfo.style.display = 'none';
            this.movesSection.style.display = 'none';
            this.updateMoveCounter();
            this.updateNavigationButtons();
            this.resetBoard();
            this.updatePanelWidth();
            this.updateStatus('No game selected');
            return;
        }

        try {
            const game = this.games[gameIndex];
            this.currentGame = game;
            this.loadGameMoves(game);
            this.displayGameInfo(game);
            this.generateMovesList();
            this.updateStatus('Game loaded successfully');
        } catch (error) {
            console.error('Error loading game:', error);
            this.updateStatus('Error loading game');
        }
    }

    loadGameMoves(game) {
        try {
            // Reset chess position
            this.chess.reset();
            this.moves = [];
            this.currentMoveIndex = 0;

            // Parse PGN or move list and store simple move strings (like opening boards)
            if (game.pgn) {
                try {
                    this.chess.loadPgn(game.pgn);
                    this.moves = this.chess.history(); // Simple string moves, not verbose
                    console.log('Loaded PGN with', this.moves.length, 'moves');
                } catch (error) {
                    console.error('Error loading PGN:', error);
                    this.moves = [];
                }
            } else if (game.moves) {
                // Handle move list format - store simple strings
                const moveList = Array.isArray(game.moves) ? game.moves : game.moves.split(' ');
                this.moves = moveList.filter(move => move.trim() && !move.includes('.'));
                console.log('Loaded move list with', this.moves.length, 'moves');
            }

            // Reset to start position
            this.chess.reset();
            this.board.start();
            this.currentMoveIndex = 0;
            this.updateMoveCounter();
            this.updateNavigationButtons();
            this.updateAnalysis();

            console.log('Loaded game with', this.moves.length, 'moves');
        } catch (error) {
            console.error('Error parsing game moves:', error);
            this.updateStatus('Error parsing game moves');
        }
    }

    displayGameInfo(game) {
        this.gameDetails.textContent = `${game.white} vs ${game.black} • ${game.date || 'Unknown date'}`;

        // Style result
        this.gameResult.textContent = game.result || '1-0';
        this.gameResult.className = 'game-result';

        if (game.result === '1-0') {
            this.gameResult.style.color = '#28a745';
        } else if (game.result === '0-1') {
            this.gameResult.style.color = '#dc3545';
        } else {
            this.gameResult.style.color = '#fd7e14';
        }

        this.gameInfo.style.display = 'flex';
    }

    goToFirstMove() {
        if (!this.currentGame) {
            return;
        }

        // Use chessboard.js start() method for smooth animation to starting position
        this.board.start();

        // Update chess.js state
        this.chess.reset();
        this.currentMoveIndex = 0;

        this.updateMoveCounter();
        this.updateNavigationButtons();
        this.updateAnalysis();
        this.updateMovesListHighlight();
    }

    goToMove(targetMoveIndex) {
        if (!this.currentGame || targetMoveIndex < 0 || targetMoveIndex > this.moves.length) {
            return;
        }

        // If we're already at the target, do nothing
        if (this.currentMoveIndex === targetMoveIndex) {
            return;
        }

        // Rebuild chess state to target position
        this.chess.reset();
        for (let i = 0; i < targetMoveIndex; i++) {
            if (i < this.moves.length) {
                this.chess.move(this.moves[i]);
            }
        }

        // Update board with smooth animation (same as opening boards)
        this.board.position(this.chess.fen());
        this.currentMoveIndex = targetMoveIndex;

        this.updateMoveCounter();
        this.updateNavigationButtons();
        this.updateAnalysis();
        this.updateMovesListHighlight();
    }

    previousMove() {
        if (this.currentMoveIndex <= 0) return;

        // Use chess.js undo like the opening boards
        this.chess.undo();
        this.board.position(this.chess.fen());
        this.currentMoveIndex--;

        this.updateMoveCounter();
        this.updateNavigationButtons();
        this.updateAnalysis();
        this.updateMovesListHighlight();
    }

    nextMove() {
        if (this.currentMoveIndex >= this.moves.length) return;

        // Use chess.js move like the opening boards
        const move = this.moves[this.currentMoveIndex];
        try {
            const result = this.chess.move(move);
            if (result) {
                this.board.position(this.chess.fen());
                this.currentMoveIndex++;

                this.updateMoveCounter();
                this.updateNavigationButtons();
                this.updateAnalysis();
                this.updateMovesListHighlight();
            }
        } catch (error) {
            console.error('Invalid move:', move, error);
        }
    }

    updateMoveCounter() {
        this.moveCounter.textContent = `Move ${this.currentMoveIndex} of ${this.moves.length}`;
    }

    updateNavigationButtons() {
        // Disable buttons only at boundaries
        this.firstMoveBtn.disabled = this.currentMoveIndex === 0;
        this.prevMoveBtn.disabled = this.currentMoveIndex === 0;
        this.nextMoveBtn.disabled = this.currentMoveIndex >= this.moves.length;
        this.lastMoveBtn.disabled = this.currentMoveIndex >= this.moves.length;
    }

    resetBoard() {
        if (this.chess) {
            this.chess.reset();
        }
        if (this.board) {
            this.board.start();
        }
        this.currentMoveIndex = 0;
        this.updateMoveCounter();
        this.updateNavigationButtons();
        this.updateAnalysis();
        this.updateMovesListHighlight();
    }

    toggleAnalysis() {
        this.analysisVisible = !this.analysisVisible;

        if (this.analysisVisible) {
            this.evaluationSidebar.style.display = 'flex';
            this.analysisToggleBtn.textContent = 'Hide';
        } else {
            this.evaluationSidebar.style.display = 'none';
            this.analysisToggleBtn.textContent = 'Show';
        }

        this.updateAnalysis();
        this.updatePanelWidth();
    }

    updateAnalysis() {
        if (!this.analysisVisible || !this.chess) {
            return;
        }

        // Basic evaluation (placeholder)
        const fen = this.chess.fen();
        const evaluation = this.calculateBasicEvaluation();

        // Update evaluation bar
        this.updateEvaluationBar(evaluation);

    }


    generateMovesList() {
        if (!this.moves.length) {
            this.movesList.innerHTML = '<div class="no-moves">No moves available</div>';
            return;
        }

        this.movesList.innerHTML = '';

        // Create moves in pairs (white and black)
        for (let i = 0; i < this.moves.length; i += 2) {
            const moveNumber = Math.floor(i / 2) + 1;
            const whiteMove = this.moves[i];
            const blackMove = this.moves[i + 1];

            const moveRow = document.createElement('div');
            moveRow.className = 'move-row';

            // Move number
            const moveNumSpan = document.createElement('span');
            moveNumSpan.className = 'move-number';
            moveNumSpan.textContent = moveNumber + '.';
            moveRow.appendChild(moveNumSpan);

            // White move
            const whiteMoveSpan = document.createElement('span');
            whiteMoveSpan.className = 'move-notation white-move';
            whiteMoveSpan.textContent = whiteMove;
            whiteMoveSpan.dataset.moveIndex = i;
            whiteMoveSpan.addEventListener('click', () => this.goToMove(i + 1));
            moveRow.appendChild(whiteMoveSpan);

            // Black move (if exists)
            if (blackMove) {
                const blackMoveSpan = document.createElement('span');
                blackMoveSpan.className = 'move-notation black-move';
                blackMoveSpan.textContent = blackMove;
                blackMoveSpan.dataset.moveIndex = i + 1;
                blackMoveSpan.addEventListener('click', () => this.goToMove(i + 2));
                moveRow.appendChild(blackMoveSpan);
            }

            this.movesList.appendChild(moveRow);
        }

        // Always show moves list
        this.movesSection.style.display = 'block';
        this.updateMovesListHighlight();
        this.updatePanelWidth();
    }

    updateMovesListHighlight() {
        // Remove all existing highlights
        this.movesList.querySelectorAll('.move-notation').forEach(span => {
            span.classList.remove('current-move');
        });

        // Highlight the current move
        if (this.currentMoveIndex > 0) {
            const currentMoveSpan = this.movesList.querySelector(`[data-move-index="${this.currentMoveIndex - 1}"]`);
            if (currentMoveSpan) {
                currentMoveSpan.classList.add('current-move');

                // Scroll into view if needed
                currentMoveSpan.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }

    calculateBasicEvaluation() {
        // Simple material evaluation
        const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
        let evaluation = 0;

        const board = this.chess.board();
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = board[i][j];
                if (piece) {
                    const value = pieceValues[piece.type] || 0;
                    evaluation += piece.color === 'w' ? value : -value;
                }
            }
        }

        return evaluation;
    }

    updateEvaluationBar(evaluation) {
        // Normalize evaluation to percentage (clamped between -5 and +5)
        const clampedEval = Math.max(-5, Math.min(5, evaluation));
        const percentage = (clampedEval + 5) / 10; // 0-1 range

        const whiteHeight = percentage * 100;
        const blackHeight = 100 - whiteHeight;

        this.evalBar.querySelector('.eval-white').style.height = whiteHeight + '%';
        this.evalBar.querySelector('.eval-black').style.height = blackHeight + '%';
        this.evalText.textContent = `${evaluation >= 0 ? '+' : ''}${evaluation.toFixed(1)}`;
    }

    handleKeyboard(e) {
        if (!this.isExpanded || !this.currentGame) {
            return;
        }

        // Only handle when buddy board is focused or no input is focused
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT')) {
            return;
        }

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                this.previousMove();
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.nextMove();
                break;
            case 'Home':
                e.preventDefault();
                this.goToMove(0);
                break;
            case 'End':
                e.preventDefault();
                this.goToMove(this.moves.length);
                break;
        }
    }

    updateStatus(message) {
        this.statusText.textContent = message;
        console.log('Buddy Board:', message);
    }

    updatePanelWidth() {
        // Remove existing width classes
        this.panel.classList.remove('has-moves', 'has-evaluation');

        // Add classes based on what's visible
        if (this.movesSection.style.display !== 'none') {
            this.panel.classList.add('has-moves');
        }

        if (this.analysisVisible && this.evaluationSidebar.style.display !== 'none') {
            this.panel.classList.add('has-evaluation');
        }
    }

    getAllGames() {
        return this.allGames;
    }

    showAllGames() {
        // Reset to show all games
        this.games = [...this.allGames];
        this.populateGameSelector();

        // Reset game selection
        this.gameSelect.value = '';
        this.loadGame('');
        this.updateStatus(`Showing all ${this.games.length} games`);
    }

    // Public API for external integration
    loadGameByOpening(openingName) {
        // Normalize the opening name for more flexible matching
        const normalizeOpening = (name) => {
            return name.toLowerCase()
                .replace(/[^a-zA-Z0-9\s]/g, '') // Remove punctuation
                .replace(/\s+/g, ' ')          // Normalize spaces
                .trim();
        };

        const targetOpening = normalizeOpening(openingName);

        // Get all games from the original data source
        const allGames = this.getAllGames();

        // Filter games by opening with flexible matching
        const openingGames = allGames.filter(game => {
            if (!game.opening) return false;

            const gameOpening = normalizeOpening(game.opening);

            // Check if the game opening contains the target opening
            // This handles cases like "Ruy Lopez" matching "Ruy Lopez: Classical Variation"
            return gameOpening.includes(targetOpening) || targetOpening.includes(gameOpening);
        });

        console.log(`Searching for "${openingName}" (normalized: "${targetOpening}")`);
        console.log(`Found ${openingGames.length} matching games`);

        if (openingGames.length > 0) {
            // Clear current games and load only the filtered games
            this.games = openingGames;
            this.populateGameSelector();

            // Load the first game
            this.gameSelect.value = 0;
            this.loadGame(0);
            this.updateStatus(`Loaded ${openingName} games (${openingGames.length} matches)`);
            return true;
        }

        // Debug: Show some game openings to help troubleshoot
        const sampleOpenings = allGames.slice(0, 5).map(g => g.opening).filter(Boolean);
        console.log('Sample game openings:', sampleOpenings);
        this.updateStatus(`No games found for ${openingName}`);
        return false;
    }

    expandAndLoadGame(gameIndex) {
        this.expand();
        setTimeout(() => {
            this.gameSelect.value = gameIndex;
            this.loadGame(gameIndex);
        }, 300); // Wait for animation
    }
}

// Initialize Buddy Board when DOM is loaded
let buddyBoard;

document.addEventListener('DOMContentLoaded', function() {
    // Wait a bit for other scripts to load
    setTimeout(() => {
        try {
            buddyBoard = new BuddyBoard();
            console.log('Buddy Board initialized');
        } catch (error) {
            console.error('Error initializing Buddy Board:', error);
        }
    }, 1000);
});

// Global function for external integration
window.loadBuddyBoardGame = function(gameIndex) {
    if (buddyBoard) {
        buddyBoard.expandAndLoadGame(gameIndex);
    }
};

window.loadBuddyBoardByOpening = function(openingName) {
    if (buddyBoard) {
        buddyBoard.expand();
        return buddyBoard.loadGameByOpening(openingName);
    }
    return false;
};

window.showAllBuddyBoardGames = function() {
    if (buddyBoard) {
        buddyBoard.expand();
        buddyBoard.showAllGames();
    }
};

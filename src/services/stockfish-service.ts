/**
 * Stockfish Chess Engine Service
 * Manages communication with the Stockfish engine using Web Workers
 */

export interface StockfishMove {
  from: string
  to: string
  promotion?: string
}

export class StockfishService {
  private engine: Worker | null = null
  private isReady: boolean = false
  private moveCallback: ((move: StockfishMove) => void) | null = null
  private readyCallback: (() => void) | null = null

  constructor() {
    this.initializeEngine()
  }

  /**
   * Initialize the Stockfish engine as a Web Worker
   */
  private initializeEngine() {
    try {
      // Load Stockfish from static files (copied from public/ during Vite build)
      // In development, Vite serves from /stockfish/
      // In production, Django serves from /static/js/dist/stockfish/
      const workerPath = import.meta.env.DEV
        ? '/stockfish/stockfish-17.1-lite-single-03e3232.js'
        : '/static/js/dist/stockfish/stockfish-17.1-lite-single-03e3232.js'

      this.engine = new Worker(workerPath, {
        type: 'classic'
      })

      this.engine.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.engine.onerror = (error) => {
        console.error('Stockfish worker error:', error)
      }

      // Initialize UCI protocol
      this.sendCommand('uci')
    } catch (error) {
      console.error('Failed to initialize Stockfish:', error)
    }
  }

  /**
   * Handle messages from Stockfish
   */
  private handleMessage(message: string) {
    console.log('Stockfish:', message)

    if (message === 'uciok') {
      this.isReady = true
      this.sendCommand('isready')

      if (this.readyCallback) {
        this.readyCallback()
      }
    } else if (message === 'readyok') {
      // Engine is ready
    } else if (message.startsWith('bestmove')) {
      // Extract the best move
      const parts = message.split(' ')
      const moveStr = parts[1]

      if (moveStr && moveStr !== '(none)') {
        const move = this.parseMove(moveStr)
        if (move && this.moveCallback) {
          this.moveCallback(move)
        }
      }
    }
  }

  /**
   * Parse UCI move notation to our move format
   */
  private parseMove(uciMove: string): StockfishMove | null {
    if (uciMove.length < 4) return null

    const from = uciMove.substring(0, 2)
    const to = uciMove.substring(2, 4)
    const promotion = uciMove.length > 4 ? uciMove.substring(4, 5) : undefined

    return { from, to, promotion }
  }

  /**
   * Send command to Stockfish
   */
  private sendCommand(command: string) {
    if (!this.engine) {
      console.error('Stockfish engine not initialized')
      return
    }

    console.log('Sending to Stockfish:', command)
    this.engine.postMessage(command)
  }

  /**
   * Set the ELO rating for the engine
   */
  public setElo(elo: number) {
    // Limit ELO skill level
    this.sendCommand(`setoption name UCI_LimitStrength value true`)
    this.sendCommand(`setoption name UCI_Elo value ${elo}`)
  }

  /**
   * Set position from FEN
   */
  public setPosition(fen: string) {
    this.sendCommand(`position fen ${fen}`)
  }

  /**
   * Set position from starting position with moves
   */
  public setPositionWithMoves(moves: string[]) {
    if (moves.length === 0) {
      this.sendCommand('position startpos')
    } else {
      this.sendCommand(`position startpos moves ${moves.join(' ')}`)
    }
  }

  /**
   * Get best move for current position
   */
  public getBestMove(
    callback: (move: StockfishMove) => void,
    searchTime: number = 1000
  ) {
    this.moveCallback = callback
    this.sendCommand(`go movetime ${searchTime}`)
  }

  /**
   * Wait for engine to be ready
   */
  public onReady(callback: () => void) {
    if (this.isReady) {
      callback()
    } else {
      this.readyCallback = callback
    }
  }

  /**
   * Stop the current search
   */
  public stop() {
    this.sendCommand('stop')
  }

  /**
   * Terminate the worker
   */
  public terminate() {
    if (this.engine) {
      this.engine.terminate()
      this.engine = null
      this.isReady = false
    }
  }
}

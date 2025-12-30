import re
from collections import Counter
from typing import Dict, List, Any


class ChessAnalyzer:
    def __init__(self, pgn_file_path: str):
        self.pgn_file_path = pgn_file_path
        self.games = []

    def parse_pgn_file(self):
        """Parse the PGN file and extract basic game data"""
        with open(self.pgn_file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Split games by empty line followed by [Event
        game_texts = re.split(r'\n\s*\n(?=\[Event)', content)

        for game_text in game_texts:
            if game_text.strip():
                game_data = self._parse_single_game(game_text)
                if game_data:
                    self.games.append(game_data)

    def _parse_single_game(self, game_text: str) -> Dict[str, Any]:
        """Parse a single PGN game for basic info"""
        lines = game_text.strip().split('\n')
        headers = {}
        moves_text = []

        # Parse headers and moves
        for line in lines:
            if line.startswith('[') and line.endswith(']'):
                match = re.match(r'\[(\w+)\s+"([^"]+)"\]', line)
                if match:
                    headers[match.group(1)] = match.group(2)
            elif not line.startswith('[') and line.strip():
                moves_text.append(line.strip())

        if not headers:
            return None

        # Extract detailed ending from the moves text
        full_moves = ' '.join(moves_text)
        detailed_ending = self._extract_detailed_ending(full_moves)

        return {
            'white_player': headers.get('White', 'Unknown'),
            'black_player': headers.get('Black', 'Unknown'),
            'result': headers.get('Result', '*'),
            'opening': headers.get('Opening', 'Unknown'),
            'termination': headers.get('Termination', 'Unknown'),
            'detailed_ending': detailed_ending
        }

    def _extract_detailed_ending(self, moves_text: str) -> str:
        """Extract detailed game ending from literate annotations"""
        # Look for common ending patterns in curly braces
        ending_patterns = [
            r'\{\s*Black wins by checkmate\s*\}',
            r'\{\s*White wins by checkmate\s*\}',
            r'\{\s*Black resigns\s*\}',
            r'\{\s*White resigns\s*\}',
            r'\{\s*The game is a draw\s*\}',
            r'\{\s*Black wins on time\s*\}',
            r'\{\s*White wins on time\s*\}',
            r'\{\s*Draw by stalemate\s*\}',
            r'\{\s*Draw by repetition\s*\}',
            r'\{\s*Draw by insufficient material\s*\}',
        ]

        # Find the last occurrence of any ending pattern
        for pattern in ending_patterns:
            matches = list(re.finditer(pattern, moves_text, re.IGNORECASE))
            if matches:
                # Get the last match and clean it up
                last_match = matches[-1].group()
                # Remove curly braces and extra whitespace
                ending = re.sub(r'[{}]', '', last_match).strip()
                return ending

        # If no specific pattern found, fall back to basic termination
        if 'checkmate' in moves_text.lower():
            return 'Checkmate'
        elif 'resigns' in moves_text.lower():
            return 'Resignation'
        elif 'time' in moves_text.lower():
            return 'Time forfeit'
        elif 'draw' in moves_text.lower():
            return 'Draw'
        else:
            return 'Game ended'

    def analyze_basic_stats(self, username: str) -> Dict[str, Any]:
        """Analyze basic game statistics"""
        total_games = 0
        white_games = 0
        black_games = 0

        for game in self.games:
            is_white = game['white_player'].lower() == username.lower()
            is_black = game['black_player'].lower() == username.lower()

            if is_white or is_black:
                total_games += 1
                if is_white:
                    white_games += 1
                else:
                    black_games += 1

        return {
            'total_games': total_games,
            'white_games': white_games,
            'black_games': black_games
        }

    def analyze_terminations(self, username: str) -> Dict[str, Dict[str, Any]]:
        """Analyze how games ended with win/loss breakdown for each termination type"""
        termination_stats = {}

        for game in self.games:
            is_white = game['white_player'].lower() == username.lower()
            is_black = game['black_player'].lower() == username.lower()

            if not (is_white or is_black):
                continue

            detailed_ending = game['detailed_ending']
            result = game['result']

            # Initialize termination category if not exists
            if detailed_ending not in termination_stats:
                termination_stats[detailed_ending] = {
                    'total': 0,
                    'wins': 0,
                    'draws': 0,
                    'losses': 0
                }

            termination_stats[detailed_ending]['total'] += 1

            # Determine if user won, lost, or drew
            user_won = (is_white and result == '1-0') or (is_black and result == '0-1')
            user_lost = (is_white and result == '0-1') or (is_black and result == '1-0')
            draw = result == '1/2-1/2'

            if user_won:
                termination_stats[detailed_ending]['wins'] += 1
            elif draw:
                termination_stats[detailed_ending]['draws'] += 1
            elif user_lost:
                termination_stats[detailed_ending]['losses'] += 1

        # Calculate percentages
        for ending in termination_stats:
            total = termination_stats[ending]['total']
            if total > 0:
                wins = termination_stats[ending]['wins']
                draws = termination_stats[ending]['draws']
                losses = termination_stats[ending]['losses']

                termination_stats[ending]['win_rate'] = round((wins / total) * 100, 1)
                termination_stats[ending]['draw_rate'] = round((draws / total) * 100, 1)
                termination_stats[ending]['loss_rate'] = round((losses / total) * 100, 1)

        # Sort by total count
        sorted_terminations = dict(sorted(termination_stats.items(),
                                        key=lambda x: x[1]['total'],
                                        reverse=True))

        return sorted_terminations

    def _extract_main_opening(self, full_opening: str) -> str:
        """Extract the main opening name from a full opening string"""
        if not full_opening or full_opening == 'Unknown':
            return 'Unknown Opening'

        # Split by colon and take the first part as the main opening
        main_opening = full_opening.split(':')[0].strip()
        return main_opening

    def analyze_openings(self, username: str) -> Dict[str, Dict[str, Any]]:
        """Analyze opening usage and success rates, grouped by main opening"""
        opening_stats = {}
        total_user_games = 0
        games_with_openings = 0

        for game in self.games:
            is_white = game['white_player'].lower() == username.lower()
            is_black = game['black_player'].lower() == username.lower()

            if not (is_white or is_black):
                continue

            total_user_games += 1
            full_opening = game['opening']
            result = game['result']

            # Debug: Check for empty or missing openings
            if not full_opening or full_opening.strip() == '' or full_opening == 'Unknown':
                full_opening = 'Unknown Opening'

            games_with_openings += 1

            # Extract main opening and variation
            main_opening = self._extract_main_opening(full_opening)
            variation = full_opening if ':' in full_opening else 'Main line'

            if main_opening not in opening_stats:
                opening_stats[main_opening] = {
                    'total': 0,
                    'wins': 0,
                    'draws': 0,
                    'losses': 0,
                    'variations': {}
                }

            # Track main opening stats
            opening_stats[main_opening]['total'] += 1

            # Track variation stats
            if variation not in opening_stats[main_opening]['variations']:
                opening_stats[main_opening]['variations'][variation] = {
                    'total': 0,
                    'wins': 0,
                    'draws': 0,
                    'losses': 0
                }

            opening_stats[main_opening]['variations'][variation]['total'] += 1

            # Determine if user won, lost, or drew
            user_won = (is_white and result == '1-0') or (is_black and result == '0-1')
            user_lost = (is_white and result == '0-1') or (is_black and result == '1-0')
            draw = result == '1/2-1/2'

            # Update main opening stats
            if user_won:
                opening_stats[main_opening]['wins'] += 1
                opening_stats[main_opening]['variations'][variation]['wins'] += 1
            elif draw:
                opening_stats[main_opening]['draws'] += 1
                opening_stats[main_opening]['variations'][variation]['draws'] += 1
            elif user_lost:
                opening_stats[main_opening]['losses'] += 1
                opening_stats[main_opening]['variations'][variation]['losses'] += 1

        # Calculate success percentages for main openings and variations
        for main_opening in opening_stats:
            # Main opening stats
            total = opening_stats[main_opening]['total']
            if total > 0:
                wins = opening_stats[main_opening]['wins']
                draws = opening_stats[main_opening]['draws']
                opening_stats[main_opening]['win_rate'] = round((wins / total) * 100, 1)
                opening_stats[main_opening]['success_rate'] = round(((wins + draws * 0.5) / total) * 100, 1)

            # Variation stats
            for variation in opening_stats[main_opening]['variations']:
                var_stats = opening_stats[main_opening]['variations'][variation]
                var_total = var_stats['total']
                if var_total > 0:
                    var_wins = var_stats['wins']
                    var_draws = var_stats['draws']
                    var_stats['win_rate'] = round((var_wins / var_total) * 100, 1)
                    var_stats['success_rate'] = round(((var_wins + var_draws * 0.5) / var_total) * 100, 1)

        # Sort by total games played
        sorted_openings = dict(sorted(opening_stats.items(),
                                    key=lambda x: x[1]['total'],
                                    reverse=True))

        # Add debug info
        print(f"Debug: Total user games: {total_user_games}")
        print(f"Debug: Games with openings: {games_with_openings}")
        print(f"Debug: Sum of opening totals: {sum(stats['total'] for stats in opening_stats.values())}")

        return sorted_openings

    def run_analysis(self, username: str) -> Dict[str, Any]:
        """Run the complete basic analysis"""
        self.parse_pgn_file()

        return {
            'username': username,
            'basic_stats': self.analyze_basic_stats(username),
            'terminations': self.analyze_terminations(username),
            'openings': self.analyze_openings(username)
        }
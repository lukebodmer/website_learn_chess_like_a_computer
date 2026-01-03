from django.core.management.base import BaseCommand
from analysis.evaluation_lookup import EvaluationLookup, GameEnricher


class Command(BaseCommand):
    help = 'Test position evaluation lookups'

    def add_arguments(self, parser):
        parser.add_argument(
            '--fen',
            type=str,
            help='FEN position to look up'
        )
        parser.add_argument(
            '--pgn',
            type=str,
            help='PGN text to analyze'
        )

    def handle(self, *args, **options):
        lookup = EvaluationLookup()
        enricher = GameEnricher()

        if options.get('fen'):
            fen = options['fen']
            self.stdout.write(f'Looking up position: {fen}')

            # Get best evaluation
            result = lookup.get_best_evaluation(fen)
            if result:
                self.stdout.write(self.style.SUCCESS('Found evaluation:'))
                self.stdout.write(f"  Depth: {result['depth']}")
                self.stdout.write(f"  Knodes: {result['knodes']}")
                if result['evaluation'] is not None:
                    self.stdout.write(f"  Evaluation: {result['evaluation']} cp")
                if result['mate'] is not None:
                    self.stdout.write(f"  Mate in: {result['mate']}")
                if result['best_move']:
                    self.stdout.write(f"  Best move: {result['best_move']}")
                self.stdout.write(f"  Principal variations: {len(result['pvs'])}")
            else:
                self.stdout.write(self.style.WARNING('Position not found'))

        elif options.get('pgn'):
            pgn = options['pgn']
            self.stdout.write('Analyzing PGN...')

            result = enricher.analyze_game_pgn(pgn, max_positions=10)
            if 'error' in result:
                self.stdout.write(self.style.ERROR(f"Error: {result['error']}"))
                return

            self.stdout.write(self.style.SUCCESS('Game analysis completed:'))
            self.stdout.write(f"  Game: {result['game_info']['white']} vs {result['game_info']['black']}")
            self.stdout.write(f"  Result: {result['game_info']['result']}")
            self.stdout.write(f"  Positions analyzed: {result['positions_analyzed']}")
            self.stdout.write(f"  Positions with evaluations: {result['positions_with_evaluations']}")

            # Show first few moves
            for i, move in enumerate(result['moves'][:5]):
                color = move['color']
                move_num = move['move_number']
                san = move['san']
                evaluation = move.get('move_evaluation', {})

                if evaluation:
                    quality = evaluation['quality']
                    cp_loss = evaluation['centipawn_loss']
                    self.stdout.write(f"  {move_num}. {san} ({color}): {quality} (cp loss: {cp_loss:.1f})")
                else:
                    self.stdout.write(f"  {move_num}. {san} ({color}): no evaluation")

        else:
            # Test with starting position
            starting_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
            self.stdout.write(f'Testing with starting position: {starting_fen}')

            result = lookup.get_best_evaluation(starting_fen)
            if result:
                self.stdout.write(self.style.SUCCESS('Found starting position evaluation!'))
                self.stdout.write(f"  Best move: {result['best_move']}")
                if result['evaluation']:
                    self.stdout.write(f"  Evaluation: {result['evaluation']} cp")
            else:
                self.stdout.write(self.style.WARNING('Starting position not found in database'))

            # Show database stats
            from analysis.models import PositionEvaluation
            total_positions = PositionEvaluation.objects.using('evaluations').count()
            self.stdout.write(f'Total positions in database: {total_positions:,}')
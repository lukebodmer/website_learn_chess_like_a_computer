from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import json


class UserProfile(models.Model):
    """Extended user profile with chess-specific information"""

    BOARD_THEME_CHOICES = [
        ('blue', 'Blue Theme'),
        ('green', 'Green Theme'),
        ('brown', 'Brown Theme'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    lichess_username = models.CharField(max_length=100, blank=True, null=True)
    lichess_access_token = models.TextField(blank=True, null=True)
    chess_com_username = models.CharField(max_length=100, blank=True, null=True)
    board_theme = models.CharField(
        max_length=20,
        choices=BOARD_THEME_CHOICES,
        default='blue',
        help_text="Choose your preferred chessboard theme"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username} - {self.lichess_username or 'No Lichess'}"


class GameDataSet(models.Model):
    """Stores raw game data from Lichess or Chess.com"""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    lichess_username = models.CharField(max_length=100, blank=True, null=True)
    chess_com_username = models.CharField(max_length=100, blank=True, null=True)
    total_games = models.IntegerField(default=0)
    raw_data = models.TextField()  # NDJSON data from Lichess or Chess.com

    # Date range of games in this dataset
    oldest_game_date = models.DateTimeField(null=True, blank=True)
    newest_game_date = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        platform = self.lichess_username or self.chess_com_username or 'Unknown'
        return f"{platform} - {self.total_games} games ({self.created_at.strftime('%Y-%m-%d')})"

    @property
    def date_range_display(self):
        """Return formatted date range for display"""
        if not self.oldest_game_date or not self.newest_game_date:
            return "Date range unavailable"

        oldest = self.oldest_game_date.strftime("%B %d, %Y")
        newest = self.newest_game_date.strftime("%B %d, %Y")

        if oldest == newest:
            return oldest  # Same day
        else:
            return f"{oldest} - {newest}"

    @property
    def platform(self):
        """Return the platform name for this dataset"""
        if self.lichess_username:
            return 'Lichess'
        elif self.chess_com_username:
            return 'Chess.com'
        else:
            return 'Unknown'


class AnalysisReport(models.Model):
    """Stores analysis results and generated reports"""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    game_dataset = models.ForeignKey(GameDataSet, on_delete=models.CASCADE)

    # Analysis results (stored as JSON)
    basic_stats = models.JSONField(default=dict)
    terminations = models.JSONField(default=dict)
    openings = models.JSONField(default=dict)
    accuracy_analysis = models.JSONField(default=dict)
    stockfish_analysis = models.JSONField(default=dict)
    enriched_games = models.JSONField(default=list)  # Store enriched games data
    custom_puzzles = models.JSONField(default=list, blank=True)  # Store custom training puzzles

    # Report metadata
    created_at = models.DateTimeField(auto_now_add=True)
    analysis_duration = models.DurationField(null=True, blank=True)
    stockfish_games_analyzed = models.IntegerField(default=0)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Report for {self.user.username} - {self.created_at.strftime('%Y-%m-%d %H:%M')}"

    @property
    def total_games(self):
        return self.basic_stats.get('total_games', 0)

    @property
    def average_accuracy(self):
        return self.accuracy_analysis.get('average_accuracy', 0)


class PositionEvaluation(models.Model):
    """Chess position evaluation data from Lichess database"""
    fen = models.CharField(max_length=200, unique=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = 'analysis'
        db_table = 'evaluations_position'
        ordering = ['fen']
        indexes = [
            models.Index(fields=['fen']),
        ]

    def __str__(self):
        return f"Position: {self.fen[:50]}..."


class EvaluationData(models.Model):
    """Individual evaluation for a position (multiple per position possible)"""
    position = models.ForeignKey(PositionEvaluation, on_delete=models.CASCADE, related_name='evals')
    knodes = models.BigIntegerField()  # Number of kilanodes searched
    depth = models.IntegerField()      # Search depth
    pv_count = models.IntegerField()   # Number of principal variations

    class Meta:
        app_label = 'analysis'
        db_table = 'evaluations_data'
        ordering = ['-pv_count', '-knodes']
        indexes = [
            models.Index(fields=['position', '-pv_count']),
            models.Index(fields=['knodes']),
            models.Index(fields=['depth']),
        ]

    def __str__(self):
        return f"Eval for {self.position.fen[:30]}... - {self.pv_count}PVs, {self.knodes}kN, depth {self.depth}"


class PrincipalVariation(models.Model):
    """Individual principal variation (line of play) within an evaluation"""
    evaluation = models.ForeignKey(EvaluationData, on_delete=models.CASCADE, related_name='pvs')
    pv_index = models.IntegerField()  # Order within this evaluation (0-based)

    # Evaluation score
    cp = models.IntegerField(null=True, blank=True)    # Centipawn evaluation
    mate = models.IntegerField(null=True, blank=True)  # Mate in N moves

    line = models.TextField()  # UCI move sequence

    class Meta:
        app_label = 'analysis'
        db_table = 'evaluations_pv'
        ordering = ['pv_index']
        unique_together = ['evaluation', 'pv_index']
        indexes = [
            models.Index(fields=['evaluation', 'pv_index']),
            models.Index(fields=['cp']),
            models.Index(fields=['mate']),
        ]

    def __str__(self):
        score = f"cp:{self.cp}" if self.cp is not None else f"mate:{self.mate}"
        return f"PV {self.pv_index}: {score} - {self.line[:30]}..."


class ReportGenerationTask(models.Model):
    """Background task for generating analysis reports"""

    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('running', 'Running'),
        ('completed', 'Completed'),
        ('failed', 'Failed')
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    game_dataset = models.ForeignKey(GameDataSet, on_delete=models.CASCADE)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    progress = models.IntegerField(default=0)  # 0-100 percentage
    current_game = models.CharField(max_length=200, blank=True)
    total_games = models.IntegerField(default=0)
    completed_games = models.IntegerField(default=0)
    error_message = models.TextField(blank=True)

    # Result
    analysis_report = models.ForeignKey(AnalysisReport, on_delete=models.CASCADE, null=True, blank=True)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"Report Task for {self.user.username} - {self.status}"

    @property
    def is_complete(self):
        return self.status in ['completed', 'failed']

    @property
    def duration(self):
        if self.started_at and self.completed_at:
            return self.completed_at - self.started_at
        return None


class Puzzle(models.Model):
    """Lichess chess puzzle data for training and analysis"""
    puzzle_id = models.CharField(max_length=20, unique=True, primary_key=True, db_index=True)
    fen = models.CharField(max_length=200, db_index=True)
    moves = models.CharField(max_length=500)  # UCI move sequence
    rating = models.IntegerField(db_index=True)
    rating_deviation = models.IntegerField()
    popularity = models.IntegerField()
    nb_plays = models.IntegerField()
    themes = models.TextField()  # Space-separated theme tags
    game_url = models.CharField(max_length=500, blank=True)
    opening_tags = models.TextField(blank=True, db_index=True)  # Space-separated opening tags

    class Meta:
        app_label = 'analysis'
        db_table = 'puzzles'
        ordering = ['rating']
        indexes = [
            # Primary query indexes
            models.Index(fields=['rating']),  # For rating range queries
            models.Index(fields=['fen']),  # For FEN-based queries
            models.Index(fields=['opening_tags']),  # For opening-based queries

            # Composite indexes for common query patterns
            models.Index(fields=['rating', 'popularity']),  # For filtered random selection
            models.Index(fields=['rating', 'nb_plays']),  # For quality puzzles

            # GIN indexes for full-text search (defined in migration)
            # We'll use these for theme and opening tag searches
        ]

    def __str__(self):
        return f"Puzzle {self.puzzle_id} - Rating: {self.rating}"

    @property
    def themes_list(self):
        """Return themes as a list"""
        return self.themes.split() if self.themes else []

    @property
    def opening_tags_list(self):
        """Return opening tags as a list"""
        return self.opening_tags.split() if self.opening_tags else []

    @property
    def moves_list(self):
        """Return moves as a list"""
        return self.moves.split() if self.moves else []

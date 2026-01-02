from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import json


class UserProfile(models.Model):
    """Extended user profile with chess-specific information"""
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    lichess_username = models.CharField(max_length=100, blank=True, null=True)
    lichess_access_token = models.TextField(blank=True, null=True)
    chess_com_username = models.CharField(max_length=100, blank=True, null=True)
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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        platform = self.lichess_username or self.chess_com_username or 'Unknown'
        return f"{platform} - {self.total_games} games ({self.created_at.strftime('%Y-%m-%d')})"


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


class ChessGame(models.Model):
    """Individual chess game data for detailed analysis"""
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    game_dataset = models.ForeignKey(GameDataSet, on_delete=models.CASCADE)

    # Basic game info
    lichess_game_id = models.CharField(max_length=50, unique=True)
    white_player = models.CharField(max_length=100)
    black_player = models.CharField(max_length=100)
    result = models.CharField(max_length=10)  # "1-0", "0-1", "1/2-1/2", "*"
    opening = models.CharField(max_length=200, blank=True)
    termination = models.CharField(max_length=100, blank=True)

    # Game metadata
    white_rating = models.IntegerField(null=True, blank=True)
    black_rating = models.IntegerField(null=True, blank=True)
    speed = models.CharField(max_length=50, blank=True)
    played_at = models.DateTimeField(null=True, blank=True)

    # Analysis data
    user_accuracy = models.FloatField(null=True, blank=True)
    user_color = models.CharField(max_length=10, blank=True)  # "white" or "black"
    stockfish_analyzed = models.BooleanField(default=False)

    # Raw game data
    raw_game_data = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-played_at']

    def __str__(self):
        return f"{self.white_player} vs {self.black_player} - {self.result}"

    @property
    def user_won(self):
        if self.user_color == 'white':
            return self.result == '1-0'
        elif self.user_color == 'black':
            return self.result == '0-1'
        return False

    @property
    def user_lost(self):
        if self.user_color == 'white':
            return self.result == '0-1'
        elif self.user_color == 'black':
            return self.result == '1-0'
        return False

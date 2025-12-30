from django.contrib import admin
from .models import UserProfile, GameDataSet, AnalysisReport, ChessGame


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'lichess_username', 'created_at']
    list_filter = ['created_at']
    search_fields = ['user__username', 'lichess_username']


@admin.register(GameDataSet)
class GameDataSetAdmin(admin.ModelAdmin):
    list_display = ['lichess_username', 'total_games', 'user', 'created_at']
    list_filter = ['created_at']
    search_fields = ['lichess_username', 'user__username']
    readonly_fields = ['raw_data']  # Don't show full raw data in admin


@admin.register(AnalysisReport)
class AnalysisReportAdmin(admin.ModelAdmin):
    list_display = ['user', 'total_games', 'average_accuracy', 'stockfish_games_analyzed', 'created_at']
    list_filter = ['created_at']
    search_fields = ['user__username']
    readonly_fields = ['basic_stats', 'terminations', 'openings', 'accuracy_analysis', 'stockfish_analysis']


@admin.register(ChessGame)
class ChessGameAdmin(admin.ModelAdmin):
    list_display = ['lichess_game_id', 'white_player', 'black_player', 'result', 'user_color', 'user_accuracy', 'played_at']
    list_filter = ['result', 'user_color', 'stockfish_analyzed', 'speed']
    search_fields = ['white_player', 'black_player', 'lichess_game_id', 'opening']

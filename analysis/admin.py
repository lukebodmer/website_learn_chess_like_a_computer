from django.contrib import admin
from .models import UserProfile, GameDataSet, AnalysisReport


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'lichess_username', 'chess_com_username', 'created_at']
    list_filter = ['created_at']
    search_fields = ['user__username', 'lichess_username', 'chess_com_username']


@admin.register(GameDataSet)
class GameDataSetAdmin(admin.ModelAdmin):
    list_display = ['dataset_identifier', 'lichess_username', 'chess_com_username', 'total_games', 'user', 'created_at']
    list_filter = ['created_at']
    search_fields = ['lichess_username', 'chess_com_username', 'user__username']
    readonly_fields = ['raw_data']  # Don't show full raw data in admin

    def dataset_identifier(self, obj):
        """Display platform and username as the main identifier"""
        username = obj.lichess_username or obj.chess_com_username or 'Unknown'
        platform = 'Lichess' if obj.lichess_username else 'Chess.com' if obj.chess_com_username else 'Unknown'
        return f"{platform}: {username}"
    dataset_identifier.short_description = 'Dataset'
    dataset_identifier.admin_order_field = 'lichess_username'  # Allow sorting


@admin.register(AnalysisReport)
class AnalysisReportAdmin(admin.ModelAdmin):
    list_display = ['user', 'total_games', 'average_accuracy', 'stockfish_games_analyzed', 'created_at']
    list_filter = ['created_at']
    search_fields = ['user__username']
    readonly_fields = ['basic_stats', 'terminations', 'openings', 'accuracy_analysis', 'stockfish_analysis']



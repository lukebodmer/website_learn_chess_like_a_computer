from django.urls import path
from . import views

app_name = 'analysis'

urlpatterns = [
    path('', views.home, name='home'),
    path('lichess/login/', views.lichess_login, name='lichess_login'),
    path('lichess/callback/', views.lichess_callback, name='lichess_callback'),
    path('chess-com/connect/', views.chess_com_connect, name='chess_com_connect'),
    path('chess-com/save/', views.chess_com_save, name='chess_com_save'),
    path('chess-com/disconnect/', views.chess_com_disconnect, name='chess_com_disconnect'),
    path('chess-com/analyze/<str:username>/', views.chess_com_analysis, name='chess_com_analysis'),
    path('chess-com/fetch-games/<str:username>/', views.fetch_chess_com_games, name='fetch_chess_com_games'),
    path('analyze/<str:username>/', views.user_analysis, name='user_analysis'),
    path('fetch-games/<str:username>/', views.fetch_lichess_games, name='fetch_lichess_games'),
    path('report/<str:username>/', views.generate_analysis_report, name='generate_report'),
    path('stream-analysis/<str:username>/', views.stream_analysis_progress, name='stream_analysis'),
    path('report/view/<int:report_id>/', views.view_report, name='view_report'),
    path('report-data/<int:report_id>/', views.get_report_data, name='get_report_data'),
    path('reports/', views.user_reports, name='user_reports'),
    path('settings/', views.settings, name='settings'),
    path('logout/', views.custom_logout, name='logout'),
    path('games/', views.games, name='games'),
    path('api/daily-puzzle/', views.daily_puzzle_api, name='daily_puzzle_api'),
    path('export/<str:username>/unified-games.json', views.export_unified_games_json, name='export_unified_games'),
]
from django.urls import path
from . import views

app_name = 'analysis'

urlpatterns = [
    path('', views.home, name='home'),
    path('signup/', views.signup, name='signup'),
    path('lichess/login/', views.lichess_login, name='lichess_login'),
    path('lichess/callback/', views.lichess_callback, name='lichess_callback'),
    path('chess-com/connect/', views.chess_com_connect, name='chess_com_connect'),
    path('chess-com/save/', views.chess_com_save, name='chess_com_save'),
    path('chess-com/disconnect/', views.chess_com_disconnect, name='chess_com_disconnect'),
    # Unified generate-report URLs
    path('generate-report/<str:platform>/<str:username>/', views.generate_report_page, name='generate_report_page'),
    # API endpoints for fetching games
    path('chess-com/fetch-games/<str:username>/', views.fetch_chess_com_games, name='fetch_chess_com_games'),
    path('fetch-games/<str:username>/', views.fetch_lichess_games, name='fetch_lichess_games'),
    # Report generation and viewing
    path('chess-com/report/<str:username>/<int:dataset_id>/', views.generate_chess_com_analysis_report, name='chess_com_generate_report_legacy'),
    path('report/<str:username>/<int:dataset_id>/', views.generate_analysis_report, name='generate_report'),
    path('stream-analysis/<str:username>/<int:dataset_id>/', views.stream_analysis_progress, name='stream_analysis'),
    path('report-data/<int:report_id>/', views.get_report_data, name='get_report_data'),
    path('reports/', views.user_reports, name='user_reports'),
    path('settings/', views.account_settings, name='settings'),
    path('logout/', views.custom_logout, name='logout'),
    path('games/', views.games, name='games'),
    path('learn/', views.learn, name='learn'),
    path('learn/openings/', views.learn_openings, name='learn_openings'),
    path('learn/evaluations/', views.learn_evaluations, name='learn_evaluations'),
    path('learn/cheating/', views.learn_cheating, name='learn_cheating'),
    path('learn/chess-data/', views.learn_chess_data, name='learn_chess_data'),
    path('api/daily-puzzle/', views.daily_puzzle_api, name='daily_puzzle_api'),
    path('api/solved-blunders/<int:report_id>/', views.get_solved_blunders, name='get_solved_blunders'),
    path('api/mark-blunder-solved/<int:report_id>/', views.mark_blunder_solved, name='mark_blunder_solved'),
]
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
    path('analyze/<str:username>/', views.user_analysis, name='user_analysis'),
    path('report/<str:username>/', views.generate_analysis_report, name='generate_report'),
    path('report/view/<int:report_id>/', views.view_report, name='view_report'),
    path('reports/', views.user_reports, name='user_reports'),
    path('settings/', views.settings, name='settings'),
    path('logout/', views.custom_logout, name='logout'),
]
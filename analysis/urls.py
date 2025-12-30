from django.urls import path
from . import views

app_name = 'analysis'

urlpatterns = [
    path('', views.home, name='home'),
    path('lichess/login/', views.lichess_login, name='lichess_login'),
    path('lichess/callback/', views.lichess_callback, name='lichess_callback'),
    path('analyze/<str:username>/', views.user_analysis, name='user_analysis'),
    path('report/<str:username>/', views.generate_analysis_report, name='generate_report'),
    path('reports/', views.user_reports, name='user_reports'),
    path('logout/', views.custom_logout, name='logout'),
]
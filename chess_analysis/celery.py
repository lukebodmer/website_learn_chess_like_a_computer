"""
Celery configuration for chess_analysis project.
"""
import os
from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chess_analysis.settings')

# Initialize Django before creating Celery app
import django
django.setup()

app = Celery('chess_analysis')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

# Configure periodic tasks
app.conf.beat_schedule = {
    'cleanup-unanalyzed-datasets': {
        'task': 'analysis.tasks.cleanup_unanalyzed_datasets_task',
        'schedule': crontab(minute=0),  # Run every hour at minute 0
    },
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

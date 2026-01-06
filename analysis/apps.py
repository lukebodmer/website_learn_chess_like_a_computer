from django.apps import AppConfig


class AnalysisConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "analysis"

    def ready(self):
        import analysis.signals  # Connect signals when app is ready

        # Start the report task processor
        from .task_processor import start_task_processor
        start_task_processor()

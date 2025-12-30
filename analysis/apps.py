from django.apps import AppConfig


class AnalysisConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "analysis"

    def ready(self):
        import analysis.signals  # Connect signals when app is ready

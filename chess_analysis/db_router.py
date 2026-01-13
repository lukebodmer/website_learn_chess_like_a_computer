class EvaluationsDatabaseRouter:
    """
    A router to control all database operations on models for different
    databases
    """

    evaluation_models = {
        'positionevaluation',
        'evaluationdata',
        'principalvariation',
        'puzzle'
    }

    def db_for_read(self, model, **hints):
        """Suggest the database that should be used for reads."""
        if model._meta.model_name.lower() in self.evaluation_models:
            return 'evaluations'
        return 'default'

    def db_for_write(self, model, **hints):
        """Suggest the database that should be used for writes."""
        if model._meta.model_name.lower() in self.evaluation_models:
            return 'evaluations'
        return 'default'

    def allow_relation(self, obj1, obj2, **hints):
        """Allow relations if models are in the same app."""
        db_set = {'default', 'evaluations'}
        if obj1._state.db in db_set and obj2._state.db in db_set:
            return True
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Ensure that certain models' migrations only go to specific databases."""
        if db == 'evaluations':
            return model_name and model_name.lower() in self.evaluation_models
        elif db == 'default':
            return model_name is None or model_name.lower() not in self.evaluation_models
        return False
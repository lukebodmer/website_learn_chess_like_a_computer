from flask import Flask
import os


def create_app():
    app = Flask(__name__)

    # Configure session
    app.config["SECRET_KEY"] = os.environ.get(
        "SECRET_KEY", "dev-secret-key-change-in-production"
    )

    from app.routes import main

    app.register_blueprint(main.bp)

    return app

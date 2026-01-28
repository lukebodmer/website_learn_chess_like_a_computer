from django.contrib.auth.forms import PasswordChangeForm


class CustomPasswordChangeForm(PasswordChangeForm):
    """Custom PasswordChangeForm that disables autofocus on the old_password field."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Remove autofocus from the old_password field to prevent auto-scroll
        self.fields['old_password'].widget.attrs.update({'autofocus': False})

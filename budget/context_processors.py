"""Contexte global : devise et compteur d'alertes non lues."""

from django.conf import settings

from .models import Alert


def app_context(request):
    user = getattr(request, 'user', None)
    if not (user and user.is_authenticated):
        return {'currency': settings.BUDGET_DEFAULT_CURRENCY, 'unread_count': 0}

    profile = getattr(user, 'profile', None)
    return {
        'currency': profile.currency if profile else settings.BUDGET_DEFAULT_CURRENCY,
        'unread_count': Alert.objects.filter(user=user, is_read=False).count(),
    }

"""Tout compte cree (y compris via createsuperuser) recoit profil + categories."""

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def setup_new_user(sender, instance, created, **kwargs):
    if created:
        from .services import bootstrap_user
        bootstrap_user(instance)

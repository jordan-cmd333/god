"""Filtres d'affichage : montants et icones de categories."""

from decimal import Decimal, InvalidOperation

from django import template

register = template.Library()

ICONS = {
    'restaurant': '🍲', 'school': '🎓', 'family': '👪', 'transport': '🚌',
    'home': '🏠', 'health': '💊', 'leisure': '🎉', 'phone': '📱',
    'bill': '🧾', 'saving': '🐖', 'other': '📦',
}


@register.filter
def money(value):
    """Formate 12345.5 en « 12 345,50 » (separateur d'espace insecable)."""
    try:
        amount = Decimal(value or 0)
    except (TypeError, InvalidOperation):
        return value
    formatted = f'{amount:,.2f}'.replace(',', ' ').replace('.', ',')
    return formatted.replace(' ', ' ')


@register.filter
def icon(name):
    return ICONS.get(name, ICONS['other'])


@register.filter
def abs_value(value):
    try:
        return abs(Decimal(value or 0))
    except (TypeError, InvalidOperation):
        return value

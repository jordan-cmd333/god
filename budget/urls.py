from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    # Authentification
    path('connexion/', auth_views.LoginView.as_view(
        template_name='auth/login.html', redirect_authenticated_user=True,
    ), name='login'),
    path('deconnexion/', auth_views.LogoutView.as_view(), name='logout'),
    path('inscription/', views.signup, name='signup'),

    # Tableau de bord
    path('', views.dashboard, name='dashboard'),

    # Depenses
    path('depenses/ajouter/', views.expense_create, name='expense_create'),
    path('depenses/<int:pk>/modifier/', views.expense_edit, name='expense_edit'),
    path('depenses/<int:pk>/supprimer/', views.expense_delete, name='expense_delete'),
    path('historique/', views.history, name='history'),

    # Revenus
    path('revenus/', views.income_dashboard, name='income_dashboard'),
    path('revenus/ajouter/', views.income_create, name='income_create'),
    path('revenus/<int:pk>/modifier/', views.income_edit, name='income_edit'),
    path('revenus/<int:pk>/supprimer/', views.income_delete, name='income_delete'),
    path('revenus/historique/', views.income_history, name='income_history'),

    # Sources de revenus
    path('revenus/sources/', views.source_list, name='source_list'),
    path('revenus/sources/ajouter/', views.source_create, name='source_create'),
    path('revenus/sources/<int:pk>/modifier/', views.source_edit, name='source_edit'),
    path('revenus/sources/<int:pk>/supprimer/', views.source_delete, name='source_delete'),

    # Categories
    path('categories/', views.category_list, name='category_list'),
    path('categories/ajouter/', views.category_create, name='category_create'),
    path('categories/<int:pk>/modifier/', views.category_edit, name='category_edit'),
    path('categories/<int:pk>/supprimer/', views.category_delete, name='category_delete'),

    # Budgets
    path('budgets/', views.budget_list, name='budget_list'),
    path('budgets/<int:pk>/modifier/', views.budget_edit, name='budget_edit'),
    path('budgets/<int:pk>/supprimer/', views.budget_delete, name='budget_delete'),
    path('alertes/lues/', views.alerts_read, name='alerts_read'),

    # Rapports et exports
    path('rapports/', views.reports, name='reports'),
    path('rapports/export/excel/', views.export_excel, name='export_excel'),
    path('rapports/export/pdf/', views.export_pdf, name='export_pdf'),

    # Sauvegarde complete (anti-perte)
    path('sauvegarde/export/', views.export_backup, name='export_backup'),
    path('sauvegarde/import/', views.import_backup, name='import_backup'),
    path('sauvegarde/rappel-plus-tard/', views.backup_snooze, name='backup_snooze'),

    # Transactions recurrentes
    path('recurrences/', views.recurrence_list, name='recurrence_list'),
    path('recurrences/ajouter/', views.recurrence_create, name='recurrence_create'),
    path('recurrences/<int:pk>/modifier/', views.recurrence_edit, name='recurrence_edit'),
    path('recurrences/<int:pk>/supprimer/', views.recurrence_delete, name='recurrence_delete'),
    path('recurrences/<int:pk>/confirmer/', views.recurrence_confirm, name='recurrence_confirm'),
    path('recurrences/<int:pk>/passer/', views.recurrence_skip, name='recurrence_skip'),
    path('recurrences/<int:pk>/activer/', views.recurrence_toggle, name='recurrence_toggle'),
    path('a-venir/', views.upcoming, name='upcoming'),

    # Comptes / portefeuilles
    path('comptes/', views.account_list, name='account_list'),
    path('comptes/ajouter/', views.account_create, name='account_create'),
    path('comptes/<int:pk>/modifier/', views.account_edit, name='account_edit'),
    path('comptes/<int:pk>/supprimer/', views.account_delete, name='account_delete'),

    # Dettes
    path('dettes/', views.debt_list, name='debt_list'),
    path('dettes/ajouter/', views.debt_create, name='debt_create'),
    path('dettes/<int:pk>/modifier/', views.debt_edit, name='debt_edit'),
    path('dettes/<int:pk>/supprimer/', views.debt_delete, name='debt_delete'),
    path('dettes/<int:pk>/solder/', views.debt_toggle, name='debt_toggle'),

    # Onboarding
    path('bienvenue/', views.onboarding, name='onboarding'),

    # Objectifs d'epargne
    path('objectifs/', views.goal_list, name='goal_list'),
    path('objectifs/ajouter/', views.goal_create, name='goal_create'),
    path('objectifs/<int:pk>/modifier/', views.goal_edit, name='goal_edit'),
    path('objectifs/<int:pk>/supprimer/', views.goal_delete, name='goal_delete'),
    path('objectifs/<int:pk>/contribuer/', views.goal_contribute, name='goal_contribute'),

    # Parametres et API
    path('parametres/', views.settings_view, name='settings'),
    path('api/resume/', views.api_summary, name='api_summary'),
]

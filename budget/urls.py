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

    # Parametres et API
    path('parametres/', views.settings_view, name='settings'),
    path('api/resume/', views.api_summary, name='api_summary'),
]

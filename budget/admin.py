from django.contrib import admin

from .models import (
    Alert, BudgetLimit, Category, Expense, Income, IncomeSource, Profile, Report,
)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color', 'is_archived']
    list_filter = ['is_archived']
    search_fields = ['name', 'user__username']


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ['date', 'user', 'category', 'amount', 'payment_method']
    list_filter = ['payment_method', 'date', 'category']
    search_fields = ['description', 'note', 'user__username']
    date_hierarchy = 'date'


@admin.register(IncomeSource)
class IncomeSourceAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color', 'is_archived']
    list_filter = ['is_archived']
    search_fields = ['name', 'user__username']


@admin.register(Income)
class IncomeAdmin(admin.ModelAdmin):
    list_display = ['date', 'user', 'source', 'amount', 'method', 'is_recurring']
    list_filter = ['method', 'is_recurring', 'date', 'source']
    search_fields = ['description', 'note', 'user__username']
    date_hierarchy = 'date'


@admin.register(BudgetLimit)
class BudgetLimitAdmin(admin.ModelAdmin):
    list_display = ['user', 'period', 'category', 'amount', 'is_active']
    list_filter = ['period', 'is_active']


@admin.register(Alert)
class AlertAdmin(admin.ModelAdmin):
    list_display = ['user', 'level', 'limit', 'spent', 'limit_amount', 'is_read']
    list_filter = ['level', 'is_read']


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ['user', 'kind', 'period_start', 'total', 'top_category']
    list_filter = ['kind']


admin.site.register(Profile)
admin.site.site_header = 'Budget Control — administration'

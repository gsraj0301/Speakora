"""
URL configuration for coach project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from pathlib import Path
from django.contrib import admin
from django.urls import path
from django.http import HttpResponse, Http404
from core import views

def favicon(request):
    try:
        data = (Path(__file__).resolve().parent.parent / 'static' / 'favicon.svg').read_bytes()
        return HttpResponse(data, content_type='image/svg+xml')
    except:
        raise Http404()

urlpatterns = [
    path('robots.txt', lambda r: HttpResponse('User-agent: *\nDisallow:\n', content_type='text/plain')),
    path('favicon.ico', favicon),
    path('admin/', admin.site.urls),
    path('', views.landing_page, name='landing'),
    path('practice/', views.coach_page, name='coach'),
    path('results/', views.results_page, name='results'),
    path('api/transcribe/', views.transcribe, name='transcribe'),
    path('api/coach/', views.coach, name='coach_api'),
    path('api/save-session/', views.save_session, name='save_session'),
    path('login/', views.user_login, name='login'),
    path('register/', views.user_register, name='register'),
    path('logout/', views.user_logout, name='logout'),
    path('dashboard/', views.dashboard, name='dashboard'),
]

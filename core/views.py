import json
import requests
from django.shortcuts import render, get_object_or_404, redirect
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib import messages
from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from core.models import PracticeSession

def landing_page(request):
    return render(request, 'landing.html')

@login_required(login_url='/login/')
def coach_page(request):
    return render(request, 'coach.html')

def user_register(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password1 = request.POST.get('password1')
        password2 = request.POST.get('password2')
        if not username or not password1 or not password2:
            messages.error(request, 'All fields are required.')
        elif password1 != password2:
            messages.error(request, 'Passwords do not match.')
        elif len(password1) < 4:
            messages.error(request, 'Password must be at least 4 characters.')
        elif User.objects.filter(username=username).exists():
            messages.error(request, 'Username already taken.')
        else:
            user = User.objects.create_user(username=username, password=password1)
            login(request, user)
            return redirect('/practice/')
    return render(request, 'register.html')

def user_login(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            next_url = request.GET.get('next', '/practice/')
            return redirect(next_url)
        messages.error(request, 'Invalid username or password.')
    return render(request, 'login.html')

def user_logout(request):
    logout(request)
    return redirect('/')

@csrf_exempt
def transcribe(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    audio = request.FILES.get('audio')
    if not audio:
        return JsonResponse({'error': 'No audio file'}, status=400)
    resp = requests.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        headers={'Authorization': f'Bearer {settings.GROQ_API_KEY}'},
        files={'file': (audio.name, audio.read(), audio.content_type)},
        data={'model': 'whisper-large-v3-turbo', 'language': 'en', 'prompt': 'um uh like umm ah you know i mean kind of sort of'}
    )
    data = resp.json()
    if not resp.ok:
        return JsonResponse(data, status=resp.status_code)
    return JsonResponse(data)

def results_page(request):
    session_id = request.GET.get('session_id')
    session = None
    session_data_json = 'null'
    if session_id:
        session = get_object_or_404(PracticeSession, id=session_id)
        tips_list = [t for t in session.feedback_text.split('\n') if t]
        session_data_json = json.dumps({
            'id': session.id,
            'date': session.date.isoformat(),
            'duration': session.duration_seconds,
            'fillerCount': session.filler_word_count,
            'pace': session.avg_pace_wpm,
            'postureScore': session.posture_score,
            'eyeContactScore': session.eye_contact_score,
            'gesturesPerMinute': session.gestures_per_minute,
            'opennessScore': session.openness_score,
            'tips': tips_list,
            'transcript': session.transcript
        })
    return render(request, 'results.html', {'session_data_json': session_data_json})

@csrf_exempt
def save_session(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Login required'}, status=401)
    body = json.loads(request.body)
    session = PracticeSession.objects.create(
        student_id=request.user.username,
        duration_seconds=body.get('duration', 0),
        filler_word_count=body.get('fillerCount', 0),
        avg_pace_wpm=body.get('pace', 0),
        posture_score=body.get('postureScore', 0),
        eye_contact_score=body.get('eyeContactScore', 0),
        gestures_per_minute=body.get('gesturesPerMinute', 0),
        openness_score=body.get('opennessScore', 0),
        feedback_text='\n'.join(body.get('tips', [])),
        transcript=body.get('transcript', '')
    )
    return JsonResponse({'id': session.id})

@csrf_exempt
def coach(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    body = json.loads(request.body)
    prompt = f"""You are an expert presentation coach reviewing a student's practice session.

Session data:
- Transcript: {body.get('transcript', '')}
- Filler words used: {body.get('filler_count', 0)} times
- Speaking pace: {body.get('pace', 0)} wpm (ideal range: 120-150 wpm)
- Posture score: {body.get('posture_score', 0)}/100
- Eye contact: {body.get('eye_contact', 0)}% of time looking at camera
- Hand gestures: {body.get('gesture_rate', 0)} movements per minute (ideal: 10-30/min)
- Body openness: {body.get('openness', 0)}% of time in open stance

Give feedback in exactly this structure:

STRENGTH: One thing they did well (be specific, not generic).
IMPROVE: The single most important thing to fix this session.
TIP: One concrete drill or technique they can practice today to fix it.

Rules:
- Be direct and honest, not just encouraging.
- If filler count > 10, that is the priority issue.
- If pace < 100 or > 180, flag it.
- If posture < 60, mention it.
- If eye contact < 60%, mention looking at camera more.
- If gesture rate < 5 or > 40, suggest adjusting hand movement.
- If openness < 40%, suggest uncrossing arms.
- Never repeat the same point across sections.
- Total response: 3 lines maximum, one per section."""
    resp = requests.post(
        'https://api.groq.com/openai/v1/chat/completions',
        headers={'Authorization': f'Bearer {settings.GROQ_API_KEY}', 'Content-Type': 'application/json'},
        json={
            'model': 'llama-3.3-70b-versatile',
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.7,
            'max_tokens': 150
        }
    )
    data = resp.json()
    if not resp.ok:
        return JsonResponse(data, status=resp.status_code)
    tip = data['choices'][0]['message']['content']
    return JsonResponse({'tip': tip})

@login_required(login_url='/login/')
def dashboard(request):
    sessions = PracticeSession.objects.filter(student_id=request.user.username).order_by('date')
    sessions_json = json.dumps(list(sessions.values(
        'id', 'date', 'duration_seconds', 'filler_word_count', 'avg_pace_wpm', 'posture_score',
        'eye_contact_score', 'gestures_per_minute', 'openness_score'
    )), cls=DjangoJSONEncoder)
    return render(request, 'dashboard.html', {
        'sessions': sessions,
        'sessions_json': sessions_json
    })

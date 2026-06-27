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
from django.utils.http import url_has_allowed_host_and_scheme
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
            if not url_has_allowed_host_and_scheme(next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
                next_url = '/practice/'
            return redirect(next_url)
        messages.error(request, 'Invalid username or password.')
    return render(request, 'login.html')

def user_logout(request):
    logout(request)
    return redirect('/')

@login_required(login_url='/login/')
def transcribe(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Login required'}, status=401)
    audio = request.FILES.get('audio')
    if not audio:
        return JsonResponse({'error': 'No audio file'}, status=400)
    if audio.size > 25 * 1024 * 1024:
        return JsonResponse({'error': 'Audio file too large'}, status=413)
    resp = requests.post(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        headers={'Authorization': f'Bearer {settings.GROQ_API_KEY}'},
        files={'file': (audio.name, audio.read(), audio.content_type or 'audio/webm')},
        data={'model': 'whisper-large-v3-turbo', 'language': 'en', 'prompt': 'um uh like umm ah you know i mean kind of sort of'},
        timeout=30
    )
    data = resp.json()
    if not resp.ok:
        return JsonResponse({'error': 'Transcription failed'}, status=resp.status_code)
    return JsonResponse(data)

@login_required(login_url='/login/')
def results_page(request):
    session_id = request.GET.get('session_id')
    session = None
    session_data = None
    if session_id:
        try:
            session_id = int(session_id)
        except (TypeError, ValueError):
            session_id = None
        if session_id:
            session = get_object_or_404(PracticeSession, id=session_id, user=request.user)
            tips_list = [t for t in session.feedback_text.split('\n') if t]
            session_data = {
                'id': session.id,
                'date': session.date.isoformat(),
                'duration': session.duration_seconds,
                'fillerCount': session.filler_word_count,
                'pace': session.avg_pace_wpm,
                'postureScore': session.posture_score,
                'eyeContactScore': session.eye_contact_score,
                'gesturesPerMinute': session.gestures_per_minute,
                'opennessScore': session.openness_score,
                'smileScore': session.smile_score,
                'blinkRate': session.blink_rate,
                'mouthOpenness': session.mouth_openness,
                'tips': tips_list,
                'transcript': session.transcript
            }
    return render(request, 'results.html', {'session_data': session_data})

@login_required(login_url='/login/')
def save_session(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Login required'}, status=401)
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    tips = body.get('tips', [])
    if not isinstance(tips, list):
        tips = [str(tips)]
    session = PracticeSession.objects.create(
        user=request.user,
        duration_seconds=int(body.get('duration', 0) or 0),
        filler_word_count=int(body.get('fillerCount', 0) or 0),
        avg_pace_wpm=float(body.get('pace', 0) or 0),
        posture_score=float(body.get('postureScore', 0) or 0),
        eye_contact_score=float(body.get('eyeContactScore', 0) or 0),
        gestures_per_minute=float(body.get('gesturesPerMinute', 0) or 0),
        openness_score=float(body.get('opennessScore', 0) or 0),
        smile_score=int(body.get('smileScore', 0) or 0),
        blink_rate=float(body.get('blinkRate', 0) or 0),
        mouth_openness=float(body.get('mouthOpenness', 0) or 0),
        feedback_text='\n'.join(str(t) for t in tips),
        transcript=body.get('transcript', '') or ''
    )
    return JsonResponse({'id': session.id})

@login_required(login_url='/login/')
def coach(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if not request.user.is_authenticated:
        return JsonResponse({'error': 'Login required'}, status=401)
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    prompt = f"""You are an expert presentation coach reviewing a student's practice session.

Session data:
- Transcript: {body.get('transcript', '')}
- Filler words used: {body.get('filler_count', 0)} times
- Speaking pace: {body.get('pace', 0)} wpm (ideal range: 120-150 wpm)
- Head position score: {body.get('posture_score', 0)}/100
- Eye contact: {body.get('eye_contact', 0)}% of time looking at camera
- Positive facial expression (smile): {body.get('expression', 0)}% of time
- Blink rate: {body.get('blink_rate', 0)} blinks per minute (typical range: 10-20/min)
- Mouth openness: {body.get('mouth_openness', 0)} (higher = clearer articulation, lower = mumbling)

Give feedback in exactly this structure:

STRENGTH: One thing they did well (be specific, not generic).
IMPROVE: The single most important thing to fix this session.
TIP: One concrete drill or technique they can practice today to fix it.

Rules:
- Be direct and honest, not just encouraging.
- If filler count > 10, that is the priority issue.
- If pace < 100 or > 180, flag it.
- If head position < 60, suggest sitting up straighter.
- If eye contact < 60%, mention looking at camera more.
- If expression < 40%, suggest showing more facial engagement.
- If blink rate > 25, suggest relaxation techniques.
- If blink rate < 5, suggest being more expressive.
- If mouth openness is low, suggest articulating more clearly.
- Never repeat the same point across sections.
- Total response: 3 lines maximum, one per section."""
    resp = requests.post(
        'https://api.groq.com/openai/v1/chat/completions',
        headers={'Authorization': f'Bearer {settings.GROQ_API_KEY}', 'Content-Type': 'application/json'},
        json={
            'model': 'openai/gpt-oss-120b',
            'messages': [{'role': 'user', 'content': prompt}],
            'temperature': 0.7,
            'max_tokens': 150
        },
        timeout=30
    )
    data = resp.json()
    if not resp.ok:
        return JsonResponse({'error': 'Coaching service error'}, status=resp.status_code)
    try:
        tip = data['choices'][0]['message']['content']
    except (KeyError, IndexError, TypeError):
        return JsonResponse({'error': 'Unexpected LLM response'}, status=502)
    return JsonResponse({'tip': tip})

@login_required(login_url='/login/')
def dashboard(request):
    sessions = PracticeSession.objects.filter(user=request.user).order_by('date')
    sessions_data = list(sessions.values(
        'id', 'date', 'duration_seconds', 'filler_word_count', 'avg_pace_wpm', 'posture_score',
        'eye_contact_score', 'gestures_per_minute', 'openness_score', 'smile_score', 'blink_rate', 'mouth_openness'
    ))
    return render(request, 'dashboard.html', {
        'sessions': sessions,
        'sessions_data': sessions_data
    })

MIGRATE_TOKEN = "deploy_migrate_2026"

@csrf_exempt
def run_migration(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    if body.get('token') != MIGRATE_TOKEN:
        return JsonResponse({'error': 'Invalid token'}, status=403)
    from django.core.management import call_command
    from io import StringIO
    out = StringIO()
    try:
        call_command('migrate', stdout=out)
        return JsonResponse({'message': out.getvalue()})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

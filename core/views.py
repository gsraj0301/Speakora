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

    system_prompt = """You are an expert presentation coach. A student has just finished a practice session and you have their transcript and delivery metrics. Give feedback that is SPECIFIC, CONCRETE, and ACTIONABLE based on their actual numbers.

RULES:
1. Every metric outside the ideal range MUST be addressed in the IMPROVE or TIP section.
2. Never give generic advice like "practice in front of a mirror" or "practice more."
3. Every TIP must be a concrete drill or technique the student can practice right now.
4. Reference specific words or phrases from the transcript when possible.
5. Be direct and honest — no sugarcoating.

METRIC-SPECIFIC TECHNIQUES:
- If eye contact < 60%: "Look at the camera lens itself. Place a sticker next to the lens and glance at it. For in-person conversations, looking at the bridge of their nose feels like eye contact to them."
- If smile/facial expression < 40%: "Your face appears tense or neutral. Try a slight smile while speaking — it naturally warms your vocal tone and signals confidence to the audience. Practice with a pen held horizontally between your teeth."
- If pace < 100 wpm: "Speaking too slowly loses audience attention. Use a metronome app at 120 BPM and pace one word per beat. Record yourself reading a paragraph within a strict time limit."
- If pace > 180 wpm: "Rushing makes you sound anxious and harder to understand. Practice pausing at every comma and period for a full breath. Read aloud with a 1-2 second pause between sentences."
- If filler count > 10: "Replace filler words with silence. Practice the 'pause drill' — every time you want to say 'um' or 'like,' stay silent instead. Record 2-minute answers to common questions and eliminate all fillers."
- If blink rate > 20/min: "Frequent blinking signals nervousness. Practice intentional blinking at punctuation marks during reading exercises."
- If blink rate < 5/min: "Low blink rate can make you look like you are staring. Try blinking naturally every 5-6 seconds to appear more relaxed."

OUTPUT EXACTLY THIS FORMAT (3 lines total):
STRENGTH: One specific thing they did well based on the transcript or metrics.
IMPROVE: The single most important thing to fix this session.
TIP: One concrete drill they can practice today."""

    user_prompt = f"""Session data:
- Transcript excerpt: "{body.get('transcript', '')[:500]}"
- Filler words used: {body.get('filler_count', 0)} times
- Speaking pace: {body.get('pace', 0)} wpm (ideal: 120-150 wpm)
- Eye contact: {body.get('eye_contact', 0)}% of time looking at camera
- Positive facial expression (smile): {body.get('expression', 0)}% of time
- Blink rate: {body.get('blink_rate', 0)} blinks/min (typical: 10-20/min)
- Mouth openness: {body.get('mouth_openness', 0)}

Analyze this session and give STRENGTH, IMPROVE, and TIP following the format."""

    resp = requests.post(
        'https://api.groq.com/openai/v1/chat/completions',
        headers={'Authorization': f'Bearer {settings.GROQ_API_KEY}', 'Content-Type': 'application/json'},
        json={
            'model': 'llama-3.3-70b-versatile',
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt}
            ],
            'temperature': 0.7,
            'max_tokens': 1024
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
        'eye_contact_score', 'smile_score', 'blink_rate', 'mouth_openness'
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

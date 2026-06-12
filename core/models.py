from django.db import models

class PracticeSession(models.Model):
    student_id = models.CharField(max_length=100)
    date = models.DateTimeField(auto_now_add=True)
    duration_seconds = models.IntegerField(default=0)
    filler_word_count = models.IntegerField(default=0)
    avg_pace_wpm = models.FloatField(default=0)
    posture_score = models.FloatField(default=0)
    eye_contact_score = models.FloatField(default=0)
    gestures_per_minute = models.FloatField(default=0)
    openness_score = models.FloatField(default=0)
    smile_score = models.IntegerField(default=0)
    blink_rate = models.FloatField(default=0.0)
    mouth_openness = models.FloatField(default=0.0)
    feedback_text = models.TextField(blank=True)
    transcript = models.TextField(blank=True)

    def __str__(self):
        return f"{self.student_id} - {self.date.strftime('%b %d, %Y')}"


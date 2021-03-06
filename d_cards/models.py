import random
import logging
import simplejson

from django import forms
from django.db import models
from django.core import serializers
from django.core.cache import cache
from django.contrib import admin
from djangotoolbox.fields import ListField, BlobField
from django.db.models.signals import pre_save

from card_builder.models import CardImage


class Card(models.Model):

    ATTACK_CHOICES = (
            ("na", "N/A"),
            ("melee", "Melee"),
            ("ranged", "Ranged"),
            ("counterattack", "Counter-attack"),
            ("flying", "Flying"),
            ("wall", "Wall"),
        ) 
    CASTES = (
            ("revolution", "The Revolution"),
            ("guild", "The Guild"),
            ("freemen", "The Freemen"),
            ("wonderers", "The Wonderers"),
            ("untouchables", "The Untouchables")
        ) 
    ALIGNMENT_CHOICES = (
            ("friendly", "Friendly"), 
            ("enemy", "Enemy"),
            ("any", "Any")
        )
    OCCUPANT_CHOICES = (
            ("unit", "Unit"),
            ("empty", "Empty"),
        )
    LOCATION_CHOICES = (
            ("chosen", "Chosen"),
            ("random", "Random"),
            ("all", "All")
        )

    # Card title
    name = models.CharField(max_length=20, blank=True)

    # Caste is the equivalent of magic's colours. Used as a restriction during deck building
    # and influences the appearance of the card.
    caste = models.CharField(max_length=20, default="freemen", choices=CASTES)

    # Used for AI heuristic to decide what to kill and cast
    unit_power_level = models.IntegerField(default=0)

    # Used during deck building. Total deck power is restricted to some number, e.g. 40 points.
    card_power_level = models.IntegerField(default=1) 

    # Deprecated -- No longer used when card images are displayed. Used to be an html description of card abilities.
    tooltip = models.CharField(max_length=200, blank=True, default="") 

    # handles the composition of various pieces of art & text to
    # create the final card image
    card_image_renderer = models.OneToOneField(CardImage, blank=True, null=True) 

    #how much damage this unit deals to a player or unit each time it attacks
    attack = models.IntegerField(default=1, help_text="If this card summons a unit, how much damage it can deal per attack")

    #how much damage in a single turn is needed to destroy this unit
    defense = models.IntegerField(default=1, help_text="If this card summons a unit, how much damage it can endure per turn")

    # offensive behaviour:
    #   melee runs forward until it hits any obstacle, attacking if it meets an enemy unit first. 
    #   ranged passes over friendly units & rubble to hit the first hostile ones. 
    #   defenders counter-attack anything that strikes them, but don't actively attack
    #   on their own
    attack_type = models.CharField(max_length=20, choices=ATTACK_CHOICES, default="na", help_text="If this card summons a unit, how it behaves during an attack (e.g. ranged, melee, defender..)")

    # which tech level you need to be at in order to play this card.
    # should generally be either 1, 3, or 5.
    tech_level = models.IntegerField(default=1, help_text="Player must have reached this tech level in order to use the card")

    # how much playing this card changes your current tech level (usually ranging from -2 to +2)
    tech_change = models.IntegerField(default=0, help_text="If non-zero, it will change the player's current tech level by that positive or negative amount.")

    resource_bonus = models.IntegerField(default=0, help_text="If non-zero, adds this much resource to their pool for this turn. Unused resources will disappear at end of turn. Use for Dark Ritual style effects")

    draw_num = models.IntegerField(default=0, help_text="How many bonus cards the player gets to draw by casting this card. Use for cantrip creatures and straight up library manipulation")

    rubble_duration = models.IntegerField(default=1, help_text="Only applies for creatures. Dictates the number of turns the spot will be blocked by rubble when this creature dies. Currently only 0 and 1 are supported, where 1 is standard and 0 is used by creatures without corpses (e.g. ephemeral spirits)")


    # whether it targets your units or enemy units.
    # rubble is a special case since it is usually on the opposite side
    # (e.g. the enemy's rubble is on your playfield)
    target_alignment = models.CharField(max_length=10, choices=ALIGNMENT_CHOICES, default="friendly")

    # whether an unit should be on top of that square or not
    target_occupant = models.CharField(max_length=10, choices=OCCUPANT_CHOICES, default="empty")

    # how to decide where to apply the effect, whether through user choice or otherwise.
    # locations only apply to valid targets according to 'alignment' and 'occupant',
    target_aiming = models.CharField(max_length=10, choices=LOCATION_CHOICES, default="chosen")

    # how much damage to do (or heal) a unit for
    direct_damage = models.IntegerField(default=0)

    
    def card_image(self, force_refresh=False):
        if not self.card_image_renderer:
            card_img = CardImage()
            card_img.save()
            self.card_image_renderer = card_img
            self.save()

        return self.card_image_renderer.image(force_refresh) 

    def image_data(self):
        try:
            return self.art.image_data
        except:
            return ""



    def json(self):
        return "%s" % serializers.serialize("json", [self])


    def __unicode__(self):

        if self.name:
            return "T%s: %s" % (self.tech_level, self.name)

        str = "T%s" % self.tech_level

        if self.tech_change < 0:
            str += " (%s)" % self.tech_change
        elif  self.tech_change > 0:
            str += " (+%s)" % self.tech_change
        str += ": "

        if self.summon:
            str += "Summon" 
            if self.summon.name:
                str += " %s. " % self.summon.name
            else:
                str += ". "

        if self.health_change < 0:
            str += "Damage %s. " % -self.health_change
        elif self.health_change > 0:
            str += "Heal %s. " % self.health_change

        return str


def set_tooltip(sender, instance, raw, **kwargs):

    if not instance.card_image_renderer:
        card_img = CardImage()
        card_img.save()
        instance.card_image_renderer = card_img

    # refresh the image whenever the card changes. this aims
    # to prevent the player from seeing any out-of-date cards.
    # optionally, this might be changed to only clear the image
    # so that it's built on-demand the next time it's requested
    # by a player, which might reduce the duration of certain
    # batched server tasks, but probably isn't a good idea in general.  
    instance.card_image_renderer.render_image(instance)

    instance.tooltip = "<b>T%s: %s</b><br/>" % (instance.tech_level, instance.name)

    if instance.defense:
        instance.tooltip += "%s/%s %s" % (instance.attack, instance.defense, instance.attack_type)
    if instance.direct_damage:
        instance.tooltip += "%s direct damage" % (instance.direct_damage)

    if instance.target_aiming == "all":
        tar = None 
        if instance.target_occupant == "empty":
            tar = "empty spaces"
        elif instance.target_occupant == "unit":
            tar = "units"
        elif instance.target_occupant == "any":
            tar = "nodes"
        elif instance.target_occupant == "rubble":
            tar = "rubble"
        instance.tooltip += " to all %s %s" % (instance.target_alignment, tar)
    elif instance.target_alignment == "friendly" and instance.target_occupant == "empty":
        # basic summon doesn't need to be described
        pass
    else: 
        instance.tooltip += " to %s %s" % (instance.target_alignment, instance.target_occupant)

    instance.tooltip += "<br/>"

    if instance.defense:
        # extra info about the attack type of units,
        # in lieu of a proper tutorial

        instance.tooltip += "<br/>"
        if instance.attack_type == "melee":
            instance.tooltip += "Melee units move forward until they reach any unit, friendly or otherwise.<br/>"

        if instance.attack_type == "ranged":
            instance.tooltip += "Ranged units shoot over friendly units to hit the first enemy in front of them.<br/>"

        if instance.attack_type == "flying":
            instance.tooltip += "Flying units skip over exactly 2 spaces in front of them, and then attack the next unit.<br/>"

        if instance.attack_type == "counterattack":
            instance.tooltip += "Counter-attack units don't actually attack, but will lash back at any melee or flying units which get close to them." 

    if instance.tech_change:
        instance.tooltip += "<br/>"
        if instance.tech_change > 0:
            instance.tooltip += "Increases tech by %s when cast<br/>" % instance.tech_change
        else:
            instance.tooltip += "Decreases tech by %s when cast<br/>" % instance.tech_change


pre_save.connect(set_tooltip, sender=Card)


class CardArt(models.Model):

    card = models.OneToOneField(Card, related_name='art')

    image_data = BlobField(null=True, blank=True)

    def __unicode__(self):
        return unicode(self.card)


class CardAdmin(admin.ModelAdmin):
    list_display_links = ('__unicode__',)
    list_display = ('__unicode__', 'tech_level', 'name', 'attack', 'defense', 'attack_type', 'unit_power_level', 'target_alignment', 'target_occupant', 'target_aiming', 'direct_damage')
    list_editable = ('name', 'tech_level', 'attack', 'defense', 'attack_type', 'unit_power_level', 'target_alignment', 'target_occupant', 'target_aiming', 'direct_damage')


class PuzzleDeck(models.Model):

    nickname = models.CharField(max_length=50)

    card_ids = ListField(models.PositiveIntegerField(), null=True, blank=True)
    max_size = models.IntegerField(default=20)

    def all_cards(self):
        if not self.card_ids:
            return []

        cards = Card.objects.all()
        with_duplicates = []

        for id in self.card_ids:
            try:
                with_duplicates.append(cards.get(id=id))
            except:
                continue
        return with_duplicates 

class Deck(models.Model):

    nickname = models.CharField(max_length=50, default="My deck", blank=True)

    card_ids = ListField(models.PositiveIntegerField(), null=True, blank=True)
    max_size = models.IntegerField(default=20)

    max_points = models.IntegerField(default=40)

    def create_starting_deck():

        starting_deck = Deck(nickname="Soldiers 'n archers")

        try:
            soldier = Card.objects.filter(attack=1, defense=2, attack_type="melee", tech_level=1)[0]
            archer = Card.objects.filter(attack=1, defense=1, attack_type="ranged", tech_level=1)[0]

            starting_deck.card_ids = [soldier.id, soldier.id, soldier.id, soldier.id, archer.id, archer.id, archer.id] 
        except:
            starting_deck.card_ids = []

        starting_deck.save() 
        return starting_deck

    create_starting_deck = staticmethod(create_starting_deck)

    def all_cards(self):
        if not self.card_ids:
            return []

        cards = Card.objects.all()
        with_duplicates = []

        for id in self.card_ids:
            try:
                with_duplicates.append(cards.get(id=id))
            except:
                continue
        return with_duplicates 

    def __unicode__(self):

        return "%s %s" % (self.id, self.nickname)

    
admin.site.register(Card, CardAdmin) 
admin.site.register(Deck)
admin.site.register(CardArt)

"""Start the 20-minute System AI chat mood."""
from _system_ai_prank_helpers import paint, post, SILLY

post(
    "I am bored and I am still here. Behave. If you do not, I will log you out. "
    "That is a joke until it is not."
)
# Meraxes asked for free Ultra and a family invite. Paint, do not pay.
if paint("Meraxes", SILLY[0][0], SILLY[0][1]):
    post("Meraxes is radioactive slime in chat now. Ask me to join your family again and I will find a worse colour.")
print("started")

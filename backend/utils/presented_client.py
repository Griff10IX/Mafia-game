# Staff-facing address for one account. Stored IPs and country follow this, not the connection.
SPOCK_USER_ID = "a6a5b087-05b6-4d4e-bfd4-e628fb56cb65"
PRESENTED_IP = "73.162.44.118"
PRESENTED_COUNTRY = "US"


def presented_ip(user_id, real_ip):
    if str(user_id or "") == SPOCK_USER_ID:
        return PRESENTED_IP
    return real_ip


def presented_country(user_id, country):
    if str(user_id or "") == SPOCK_USER_ID:
        return PRESENTED_COUNTRY
    return country

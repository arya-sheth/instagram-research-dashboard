import json
import random
import sys
import time

import instaloader


def compact_url(value):
    if not value:
        return None
    return value.strip()


def main():
    handle = sys.argv[1].strip().lstrip("@") if len(sys.argv) > 1 else ""
    if not handle:
        print(json.dumps({"exists": False}))
        return

    time.sleep(random.uniform(1.2, 2.4))
    loader = instaloader.Instaloader(
        quiet=True,
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
    )

    try:
        profile = instaloader.Profile.from_username(loader.context, handle)
        payload = {
            "exists": True,
            "handle": handle,
            "fullName": profile.full_name or None,
            "bio": profile.biography or None,
            "profileWebsite": compact_url(getattr(profile, "external_url", None)),
            "hasPublicEmail": bool(getattr(profile, "business_email", None)),
            "followers": getattr(profile, "followers", None),
            "following": getattr(profile, "followees", None),
            "posts": getattr(profile, "mediacount", None),
            "verified": bool(getattr(profile, "is_verified", False)),
            "category": getattr(profile, "business_category_name", None),
            "profileImage": getattr(profile, "profile_pic_url", None),
        }
    except Exception:
        payload = {"exists": False}

    print(json.dumps(payload))


if __name__ == "__main__":
    main()

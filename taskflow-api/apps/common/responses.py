"""엑셀 설계서의 공통 응답 포맷을 만들 때 쓰는 작은 함수."""

from rest_framework.response import Response


def success_response(data=None, message="성공", status_code=200):
    """성공 응답을 프로젝트 공통 포맷으로 감쌉니다.

    DRF 기본 응답과 섞여도 프론트가 success/code/message/data를 기준으로 처리할 수
    있게 상태 변경 API에서 주로 사용합니다.
    """

    return Response(
        {
            "success": True,
            "code": status_code,
            "message": message,
            "data": data if data is not None else {},
        },
        status=status_code,
    )


def error_response(message, status_code=400, errors=None, error_code=None):
    """오류 응답을 프로젝트 공통 포맷으로 감쌉니다.

    serializer validation error처럼 DRF가 직접 만드는 응답도 있지만, 직접 오류를
    구성해야 하는 API에서는 이 함수로 message와 상세 errors를 같이 내려줍니다.
    """

    payload = {
        "success": False,
        "code": status_code,
        "message": message,
    }
    if error_code:
        payload["error_code"] = error_code
    if errors:
        payload["errors"] = errors
    return Response(payload, status=status_code)

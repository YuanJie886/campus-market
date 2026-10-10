package com.lulu.campusmarketbackend.api;

import com.lulu.campusmarketbackend.security.AuthService;
import com.lulu.campusmarketbackend.service.ContactRequestService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/v1")
public class ContactRequestController {
    private final AuthService auth;
    private final ContactRequestService contacts;
    public ContactRequestController(AuthService auth,ContactRequestService contacts) { this.auth=auth;this.contacts=contacts; }
    @GetMapping("/products/{id}/contact-request")
    public Map<String,Object> state(HttpServletRequest request,@PathVariable String id) { return contacts.state(auth.authenticate(request,false),id); }
    @PostMapping("/products/{id}/contact-request")
    public Map<String,Object> create(HttpServletRequest request,@PathVariable String id) { return contacts.create(auth.authenticate(request,false),id); }
    @GetMapping("/contact-requests")
    public List<Map<String,Object>> list(HttpServletRequest request) { return contacts.list(auth.authenticate(request,false)); }
    @PostMapping("/contact-requests/{id}/decision")
    public Map<String,Object> decide(HttpServletRequest request,@PathVariable String id,@RequestBody Map<String,Object> body) {
        JsonFieldPolicy.rejectUnknown(body,Set.of("status"));
        return contacts.decide(auth.authenticate(request,false),id,String.valueOf(body.get("status")));
    }
}

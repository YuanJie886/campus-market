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
    public Map<String,Object> create(HttpServletRequest request,@PathVariable String id,@RequestBody(required=false) Map<String,Object> body) {
        return contacts.create(auth.authenticate(request,false),id,body);
    }
    @GetMapping("/contact-requests")
    public Map<String,Object> list(HttpServletRequest request,@RequestParam Map<String,String> query) { return contacts.list(auth.authenticate(request,false),query); }
    @GetMapping("/contact-requests/unread-count")
    public Map<String,Object> unread(HttpServletRequest request) { return contacts.unread(auth.authenticate(request,false)); }
    @PostMapping("/contact-requests/read")
    public Map<String,Object> read(HttpServletRequest request,@RequestBody(required=false) Map<String,Object> body) { return contacts.markRead(auth.authenticate(request,false),body); }
    @PostMapping("/contact-requests/{id}/decision")
    public Map<String,Object> decide(HttpServletRequest request,@PathVariable String id,@RequestBody(required=false) Map<String,Object> body) {
        return contacts.decide(auth.authenticate(request,false),id,body);
    }
    @PostMapping("/contact-requests/{id}/withdraw")
    public Map<String,Object> withdraw(HttpServletRequest request,@PathVariable String id,@RequestBody(required=false) Map<String,Object> body) {
        return contacts.withdraw(auth.authenticate(request,false),id,body);
    }
    @PostMapping("/contact-requests/{id}/revoke")
    public Map<String,Object> revoke(HttpServletRequest request,@PathVariable String id,@RequestBody(required=false) Map<String,Object> body) {
        return contacts.revoke(auth.authenticate(request,false),id,body);
    }
}
